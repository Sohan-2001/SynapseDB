use crate::chunk::ColumnarChunk;
use std::fs::{File, OpenOptions};
use std::io::{self, BufReader, BufWriter};
use std::path::{Path, PathBuf};

pub struct SegmentManager {
    base_dir: PathBuf,
}

impl SegmentManager {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> io::Result<Self> {
        let dir = base_dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir)?;
        Ok(Self { base_dir: dir })
    }

    pub fn segment_path(&self, table_name: &str, segment_id: u32) -> PathBuf {
        self.base_dir
            .join(table_name)
            .join(format!("segment_{:08}.col", segment_id))
    }

    pub fn flush_chunk(&self, table_name: &str, chunk: &ColumnarChunk) -> io::Result<PathBuf> {
        let path = self.segment_path(table_name, chunk.chunk_id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let temp_path = path.with_extension("tmp");
        {
            let file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&temp_path)?;
            let writer = BufWriter::new(file);
            bincode::serialize_into(writer, chunk)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        }

        std::fs::rename(temp_path, &path)?;
        Ok(path)
    }

    pub fn load_chunk(&self, path: &Path) -> io::Result<ColumnarChunk> {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        bincode::deserialize_from(reader)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
    }

    pub fn load_all_segments(&self, table_name: &str) -> io::Result<Vec<ColumnarChunk>> {
        let table_dir = self.base_dir.join(table_name);
        if !table_dir.exists() {
            return Ok(Vec::new());
        }

        let mut chunks = Vec::new();
        let mut entries: Vec<_> = std::fs::read_dir(table_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "col"))
            .collect();

        entries.sort_by_key(|e| e.path());

        for entry in entries {
            let chunk = self.load_chunk(&entry.path())?;
            chunks.push(chunk);
        }

        Ok(chunks)
    }
}
