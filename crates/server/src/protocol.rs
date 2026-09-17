use thiserror::Error;

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Push {
        table: String,
        payload: String,
    },
    Query {
        query: String,
    },
    Ping,
    Schema {
        table: Option<String>,
    },
    Info,
    Flush,
}

#[derive(Error, Debug)]
pub enum ProtocolError {
    #[error("Unknown or empty command")]
    EmptyCommand,
    #[error("Syntax error: {0}")]
    Syntax(String),
}

pub struct ProtocolParser;

impl ProtocolParser {
    pub fn parse(line: &str) -> Result<Command, ProtocolError> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err(ProtocolError::EmptyCommand);
        }

        // Check if RESP Array format: *<len>\r\n$<len>\r\n...
        if trimmed.starts_with('*') {
            return Self::parse_resp(trimmed);
        }

        // Standard text command: PUSH <table> <payload>
        let mut parts = trimmed.splitn(3, ' ');
        let cmd = parts.next().unwrap().to_ascii_uppercase();

        match cmd.as_str() {
            "PING" => Ok(Command::Ping),
            "INFO" => Ok(Command::Info),
            "FLUSH" => Ok(Command::Flush),
            "PUSH" => {
                let table = parts
                    .next()
                    .ok_or_else(|| ProtocolError::Syntax("Usage: PUSH <table_name> <payload>".into()))?
                    .to_string();
                let payload = parts
                    .next()
                    .ok_or_else(|| ProtocolError::Syntax("Usage: PUSH <table_name> <payload>".into()))?
                    .to_string();
                Ok(Command::Push { table, payload })
            }
            "QUERY" => {
                // All text after QUERY is the query
                let rest = trimmed[cmd.len()..].trim().to_string();
                if rest.is_empty() {
                    return Err(ProtocolError::Syntax("Usage: QUERY <sql_or_nl>".into()));
                }
                Ok(Command::Query { query: rest })
            }
            "SCHEMA" => {
                let table = parts.next().map(|s| s.to_string());
                Ok(Command::Schema { table })
            }
            _ => {
                // If query without prefix starts with SELECT
                if cmd == "SELECT" {
                    Ok(Command::Query {
                        query: trimmed.to_string(),
                    })
                } else {
                    Err(ProtocolError::Syntax(format!("Unknown command '{}'", cmd)))
                }
            }
        }
    }

    fn parse_resp(input: &str) -> Result<Command, ProtocolError> {
        // Minimal RESP parser for array of bulk strings
        let lines: Vec<&str> = input.split("\r\n").filter(|s| !s.is_empty()).collect();
        let mut args = Vec::new();

        let mut i = 0;
        if lines.is_empty() || !lines[0].starts_with('*') {
            return Err(ProtocolError::Syntax("Invalid RESP header".into()));
        }
        i += 1;

        while i < lines.len() {
            if lines[i].starts_with('$') {
                i += 1;
                if i < lines.len() {
                    args.push(lines[i]);
                    i += 1;
                }
            } else {
                i += 1;
            }
        }

        if args.is_empty() {
            return Err(ProtocolError::EmptyCommand);
        }

        let cmd = args[0].to_ascii_uppercase();
        match cmd.as_str() {
            "PING" => Ok(Command::Ping),
            "INFO" => Ok(Command::Info),
            "FLUSH" => Ok(Command::Flush),
            "PUSH" => {
                if args.len() < 3 {
                    return Err(ProtocolError::Syntax("Usage: PUSH <table_name> <payload>".into()));
                }
                Ok(Command::Push {
                    table: args[1].to_string(),
                    payload: args[2..].join(" "),
                })
            }
            "QUERY" => {
                if args.len() < 2 {
                    return Err(ProtocolError::Syntax("Usage: QUERY <query>".into()));
                }
                Ok(Command::Query {
                    query: args[1..].join(" "),
                })
            }
            "SCHEMA" => Ok(Command::Schema {
                table: args.get(1).map(|s| s.to_string()),
            }),
            _ => Err(ProtocolError::Syntax(format!("Unknown command '{}'", cmd))),
        }
    }
}
