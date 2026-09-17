use crate::ast::{AggregateFunc, BinaryOperator, Expr, SelectQuery};
use synapse_catalog::CatalogValue;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ParseError {
    #[error("Syntax error: {0}")]
    Syntax(String),
    #[error("Unexpected end of query")]
    UnexpectedEof,
    #[error("Unsupported operator: {0}")]
    UnsupportedOperator(String),
}

pub struct SqlParser<'a> {
    tokens: Vec<&'a str>,
    cursor: usize,
}

impl<'a> SqlParser<'a> {
    pub fn parse(sql: &'a str) -> Result<SelectQuery, ParseError> {
        let tokens = Self::tokenize(sql);
        let mut parser = Self { tokens, cursor: 0 };
        parser.parse_select()
    }

    fn tokenize(sql: &'a str) -> Vec<&'a str> {
        let mut tokens = Vec::new();
        let bytes = sql.as_bytes();
        let mut i = 0;

        while i < bytes.len() {
            // Skip whitespace
            if bytes[i].is_ascii_whitespace() || bytes[i] == b',' {
                i += 1;
                continue;
            }

            // String literals: 'string' or "string"
            if bytes[i] == b'\'' || bytes[i] == b'"' {
                let quote = bytes[i];
                let start = i;
                i += 1;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                if i < bytes.len() {
                    i += 1; // skip closing quote
                }
                tokens.push(&sql[start..i]);
                continue;
            }

            // Multi-char operators: <=, >=, !=, <>
            if i + 1 < bytes.len() {
                let two = &sql[i..i + 2];
                if two == "<=" || two == ">=" || two == "!=" || two == "<>" {
                    tokens.push(two);
                    i += 2;
                    continue;
                }
            }

            // Single-char operators or parens: =, <, >, (, ), *
            if matches!(bytes[i], b'=' | b'<' | b'>' | b'(' | b')' | b'*') {
                tokens.push(&sql[i..i + 1]);
                i += 1;
                continue;
            }

            // Words or identifiers or numbers
            let start = i;
            while i < bytes.len()
                && !bytes[i].is_ascii_whitespace()
                && !matches!(bytes[i], b',' | b'(' | b')' | b'=' | b'<' | b'>' | b'\'' | b'"')
            {
                i += 1;
            }
            tokens.push(&sql[start..i]);
        }

        tokens
    }

    fn peek(&self) -> Option<&'a str> {
        self.tokens.get(self.cursor).copied()
    }

    fn next_token(&mut self) -> Result<&'a str, ParseError> {
        let tok = self.tokens.get(self.cursor).copied().ok_or(ParseError::UnexpectedEof)?;
        self.cursor += 1;
        Ok(tok)
    }

    fn parse_select(&mut self) -> Result<SelectQuery, ParseError> {
        let first = self.next_token()?;
        if !first.eq_ignore_ascii_case("SELECT") {
            return Err(ParseError::Syntax(format!("Expected SELECT, got {}", first)));
        }

        let mut projections = Vec::new();

        loop {
            let tok = self.peek().ok_or(ParseError::UnexpectedEof)?;
            if tok.eq_ignore_ascii_case("FROM") {
                break;
            }

            let expr = self.parse_projection_expr()?;
            projections.push(expr);

            // Optional comma consumed by tokenizer
        }

        let from_tok = self.next_token()?;
        if !from_tok.eq_ignore_ascii_case("FROM") {
            return Err(ParseError::Syntax(format!("Expected FROM, got {}", from_tok)));
        }

        let table = self.next_token()?.to_string();

        let mut predicate = None;
        let mut limit = None;

        while let Some(tok) = self.peek() {
            if tok.eq_ignore_ascii_case("WHERE") {
                self.next_token()?;
                predicate = Some(self.parse_predicate()?);
            } else if tok.eq_ignore_ascii_case("LIMIT") {
                self.next_token()?;
                let limit_tok = self.next_token()?;
                let n = limit_tok
                    .parse::<usize>()
                    .map_err(|_| ParseError::Syntax(format!("Invalid LIMIT: {}", limit_tok)))?;
                limit = Some(n);
            } else {
                break;
            }
        }

        Ok(SelectQuery {
            table,
            projections,
            predicate,
            limit,
        })
    }

    fn parse_projection_expr(&mut self) -> Result<Expr, ParseError> {
        let tok = self.next_token()?;
        let upper = tok.to_ascii_uppercase();

        if upper == "*" {
            return Ok(Expr::Column("*".to_string()));
        }

        if matches!(upper.as_str(), "COUNT" | "SUM" | "AVG" | "MIN" | "MAX") {
            let open_paren = self.next_token()?;
            if open_paren != "(" {
                return Err(ParseError::Syntax(format!("Expected '(', got {}", open_paren)));
            }

            let arg_tok = self.next_token()?;
            let arg = if arg_tok == "*" {
                None
            } else {
                Some(Box::new(Expr::Column(arg_tok.to_string())))
            };

            let close_paren = self.next_token()?;
            if close_paren != ")" {
                return Err(ParseError::Syntax(format!("Expected ')', got {}", close_paren)));
            }

            let func = match upper.as_str() {
                "COUNT" => AggregateFunc::Count,
                "SUM" => AggregateFunc::Sum,
                "AVG" => AggregateFunc::Avg,
                "MIN" => AggregateFunc::Min,
                "MAX" => AggregateFunc::Max,
                _ => unreachable!(),
            };

            return Ok(Expr::Aggregate { func, arg });
        }

        Ok(Expr::Column(tok.to_string()))
    }

    fn parse_predicate(&mut self) -> Result<Expr, ParseError> {
        let left_col = self.next_token()?;
        let op_tok = self.next_token()?;
        let right_lit = self.next_token()?;

        let op = match op_tok {
            "=" | "==" => BinaryOperator::Eq,
            "!=" | "<>" => BinaryOperator::NotEq,
            "<" => BinaryOperator::Lt,
            "<=" => BinaryOperator::Lte,
            ">" => BinaryOperator::Gt,
            ">=" => BinaryOperator::Gte,
            _ if op_tok.eq_ignore_ascii_case("LIKE") => BinaryOperator::Like,
            _ => return Err(ParseError::UnsupportedOperator(op_tok.to_string())),
        };

        let lit_value = Self::parse_literal(right_lit);

        Ok(Expr::BinaryOp {
            left: Box::new(Expr::Column(left_col.to_string())),
            op,
            right: Box::new(Expr::Literal(lit_value)),
        })
    }

    fn parse_literal(tok: &str) -> CatalogValue {
        if (tok.starts_with('\'') && tok.ends_with('\''))
            || (tok.starts_with('"') && tok.ends_with('"'))
        {
            return CatalogValue::Utf8(tok[1..tok.len() - 1].to_string());
        }

        if let Ok(i) = tok.parse::<i64>() {
            return CatalogValue::Int64(i);
        }

        if let Ok(f) = tok.parse::<f64>() {
            return CatalogValue::Float64(f);
        }

        if tok.eq_ignore_ascii_case("true") {
            return CatalogValue::Bool(true);
        }
        if tok.eq_ignore_ascii_case("false") {
            return CatalogValue::Bool(false);
        }
        if tok.eq_ignore_ascii_case("null") {
            return CatalogValue::Null;
        }

        // Fallback string
        CatalogValue::Utf8(tok.to_string())
    }
}
