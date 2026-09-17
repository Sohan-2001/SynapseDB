use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use crc32fast::Hasher;
use std::io::{self, Read, Write};
use thiserror::Error;

pub const WAL_HEADER_SIZE: usize = 24;

#[derive(Error, Debug)]
pub enum WalError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("Corrupt record at row_id {row_id}: expected CRC 0x{expected:08X}, got 0x{actual:08X}")]
    CrcMismatch {
        row_id: u64,
        expected: u32,
        actual: u32,
    },
    #[error("Unexpected end of file while reading record")]
    UnexpectedEof,
    #[error("Invalid payload length: {0} bytes")]
    InvalidPayloadLength(u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalRecord {
    pub crc32: u32,
    pub timestamp_ns: i64,
    pub row_id: u64,
    pub payload_len: u32,
    pub payload: Vec<u8>,
}

impl WalRecord {
    pub fn new(timestamp_ns: i64, row_id: u64, payload: Vec<u8>) -> Self {
        let payload_len = payload.len() as u32;
        let crc32 = Self::calculate_crc32(timestamp_ns, row_id, &payload);
        Self {
            crc32,
            timestamp_ns,
            row_id,
            payload_len,
            payload,
        }
    }

    pub fn calculate_crc32(timestamp_ns: i64, row_id: u64, payload: &[u8]) -> u32 {
        let mut hasher = Hasher::new();
        hasher.update(&timestamp_ns.to_le_bytes());
        hasher.update(&row_id.to_le_bytes());
        hasher.update(&(payload.len() as u32).to_le_bytes());
        hasher.update(payload);
        hasher.finalize()
    }

    pub fn encode<W: Write>(&self, writer: &mut W) -> io::Result<()> {
        writer.write_u32::<LittleEndian>(self.crc32)?;
        writer.write_i64::<LittleEndian>(self.timestamp_ns)?;
        writer.write_u64::<LittleEndian>(self.row_id)?;
        writer.write_u32::<LittleEndian>(self.payload_len)?;
        writer.write_all(&self.payload)?;
        Ok(())
    }

    pub fn decode<R: Read>(reader: &mut R) -> Result<Option<Self>, WalError> {
        let mut header_buf = [0u8; WAL_HEADER_SIZE];
        match reader.read_exact(&mut header_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                return Ok(None);
            }
            Err(e) => return Err(WalError::Io(e)),
        }

        let mut slice = &header_buf[..];
        let crc32 = slice.read_u32::<LittleEndian>()?;
        let timestamp_ns = slice.read_i64::<LittleEndian>()?;
        let row_id = slice.read_u64::<LittleEndian>()?;
        let payload_len = slice.read_u32::<LittleEndian>()?;

        // Maximum safe single payload in WAL: 128 MB
        if payload_len > 128 * 1024 * 1024 {
            return Err(WalError::InvalidPayloadLength(payload_len));
        }

        let mut payload = vec![0u8; payload_len as usize];
        if let Err(e) = reader.read_exact(&mut payload) {
            if e.kind() == io::ErrorKind::UnexpectedEof {
                return Err(WalError::UnexpectedEof);
            }
            return Err(WalError::Io(e));
        }

        let computed_crc = Self::calculate_crc32(timestamp_ns, row_id, &payload);
        if computed_crc != crc32 {
            return Err(WalError::CrcMismatch {
                row_id,
                expected: crc32,
                actual: computed_crc,
            });
        }

        Ok(Some(Self {
            crc32,
            timestamp_ns,
            row_id,
            payload_len,
            payload,
        }))
    }
}
