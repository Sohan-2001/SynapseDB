use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Serialize, Deserialize)]
pub struct SynonymMap {
    // Alias -> Canonical Name
    aliases: RwLock<HashMap<String, String>>,
}

impl Clone for SynonymMap {
    fn clone(&self) -> Self {
        Self {
            aliases: RwLock::new(self.aliases.read().unwrap().clone()),
        }
    }
}

impl Default for SynonymMap {
    fn default() -> Self {
        let sm = Self {
            aliases: RwLock::new(HashMap::new()),
        };

        // Preload standard common domain synonyms
        sm.register("fare", "amount");
        sm.register("cost", "amount");
        sm.register("price", "amount");
        sm.register("total", "amount");
        sm.register("expense", "amount");

        sm.register("user", "user_id");
        sm.register("client", "user_id");
        sm.register("customer", "user_id");

        sm.register("time", "timestamp");
        sm.register("date", "timestamp");
        sm.register("created_at", "timestamp");
        sm.register("datetime", "timestamp");

        sm.register("lat", "latitude");
        sm.register("lon", "longitude");
        sm.register("lng", "longitude");

        sm.register("msg", "message");
        sm.register("description", "message");
        sm.register("text", "message");

        sm
    }
}

impl SynonymMap {
    pub fn new() -> Self {
        Self {
            aliases: RwLock::new(HashMap::new()),
        }
    }

    pub fn normalize_key(name: &str) -> String {
        name.trim().to_lowercase().replace(['-', ' '], "_")
    }

    pub fn register(&self, alias: &str, canonical: &str) {
        let key = Self::normalize_key(alias);
        let target = Self::normalize_key(canonical);
        self.aliases.write().unwrap().insert(key, target);
    }

    pub fn resolve(&self, name: &str) -> String {
        let key = Self::normalize_key(name);
        let map = self.aliases.read().unwrap();
        if let Some(canonical) = map.get(&key) {
            canonical.clone()
        } else {
            key
        }
    }

    pub fn all_synonyms(&self) -> Vec<(String, String)> {
        self.aliases
            .read()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}
