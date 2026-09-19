# SynapseDB: Ingestion & Query Syntax Rules

> **Architecture Context**: SynapseDB uses an ultra-fast, deterministic **Small Language Model (SLM)** and zero-overhead columnar parser rather than a multi-billion-parameter cloud LLM. 
> 
> Because it runs locally on the CPU with **sub-millisecond write latency (< 1 ms)** and **microsecond analytical query latency (< 50 μs)**, it relies on predictable syntactical structures. Random, unstructured sentences are not magically transformed into relational tables without key-value cues.

---

## 1. Ingestion Rules (Writing Data)

Every write to SynapseDB is appended to the Write-Ahead Log (`active.wal`), assigned a 64-bit `RowID`, and dynamically indexed into columnar vectors.

### A. Supported Formats Summary

| Format | Example Input | Resulting Database Schema | Best For |
| :--- | :--- | :--- | :--- |
| **Format 1: Key-Value** | `coffee: 100, tea: 10, cab_cost: 500` | 3 Columns: `coffee` (Int64), `tea` (Int64), `cab_cost` (Int64) | Quick typing, logs, shell scripts |
| **Format 2: Single JSON** | `{"item": "coffee", "amount": 100.0}` | 2 Columns: `item` (Utf8), `amount` (Float64) | Microservices, API payloads |
| **Format 3: JSON Array** | `[{"item": "coffee", "cost": 100}, {"item": "tea", "cost": 10}]` | 2 Separate Rows with columns `item` & `cost` | Multi-row batch uploads |
| **Format 4: Unstructured Text** | `Driver Marcus picked up customer at Terminal 2` | 1 Column: `message` (Utf8) | Unformatted logs, plain text notes |

---

### Rule 1: Key-Value Syntax (Plain Text Ingestion)

When writing without JSON curly braces, SynapseDB's SLM extractor looks for key-value delimiters: **colon (`:`)** or **equals (`=`)**.

* **Valid Keys**: Must start with a letter/underscore and contain letters, numbers, underscores, or hyphens (`[a-zA-Z_][a-zA-Z0-9_-]*`). **Keys cannot have spaces**.
* **Key-Value Separators**: `:` or `=`
* **Pair Separators**: Comma (`,`), semicolon (`;`), or whitespace.

#### ✅ Correct Examples:
```text
coffee: 100, tea: 10, cab_cost: 500
item: "latte", price: 4.50, is_hot: true
user_id=1042 status="active" latency_ms=18.4
```

#### ❌ Incorrect Examples (Becomes Unparsed `message`):
```text
coffee 100, tea 10, cab cost 500       <-- Missing ':' or '='. Database treats this as words.
cab cost: 500                          <-- Space inside key "cab cost". Use "cab_cost: 500".
```

---

### Rule 2: JSON Syntax

Standard JSON is parsed directly with dynamic schema inference and type-casting.

#### Single Record Object:
```json
{
  "fare": 45.50,
  "user_id": 1001,
  "driver": "Alice",
  "active": true
}
```
* Automatically maps to:
  * `fare` -> `Float64`
  * `user_id` -> `Int64`
  * `driver` -> `Utf8`
  * `active` -> `Bool`

#### Multi-Record Batch (JSON Array):
```json
[
  {"item": "coffee", "cost": 100},
  {"item": "tea", "cost": 10},
  {"item": "cab", "cost": 500}
]
```
* **Note**: In the Desktop UI (Ingestion Lab), pasting a JSON array automatically triggers **Batch Mode**, appending 3 distinct rows and giving a batch ACK.

---

### Rule 3: Synonyms & Alias Normalization

SynapseDB has a built-in semantic synonym resolver. When numerical columns are recognized with common business aliases, they automatically resolve to canonical metrics:

* `fare`, `cost`, `price`, `charge` -> Normalized to **`amount`**
* `user`, `rider_id`, `customer_id` -> Normalized to **`user_id`**

---

### Rule 4: Unstructured Fallback (`message` column)

If the incoming string contains no JSON structure, no `key: value` pairs, and no currency pattern (`$XX.XX`):
* SynapseDB does **not** reject or drop the data.
* It safely preserves the entire string inside a `message` column (`Utf8`).
* It tags the entry as `unparsed_text`.

---

## 2. Query Rules (Searching Data)

SynapseDB provides two query modes: **Direct SQL** and **Natural Language (SLM)**.

---

### Mode 1: SQL Grammar & Syntactical Rules

SynapseDB implements an in-memory vectorized SQL executor. Queries must adhere to the following grammar:

```sql
SELECT <projections> FROM <table_name> [WHERE <predicate>] [LIMIT <n>]
```

#### 1. Projections
* **Wildcard**: `SELECT * FROM rides`
* **Column List**: `SELECT driver, amount, city FROM rides`
* **Aggregations**:
  * `COUNT(*)`: Count total rows
  * `SUM(<col>)`: Sum of numeric column
  * `AVG(<col>)`: Average of numeric column
  * `MIN(<col>)`: Minimum numeric value
  * `MAX(<col>)`: Maximum numeric value

> **Rule**: Mixing raw columns with aggregate functions without `GROUP BY` is unsupported (e.g. `SELECT driver, SUM(amount)` will return an error). Use either column projections OR aggregate projections.

#### 2. Where Predicates (Filters)
* **Numeric Comparison Operators**: `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`
  ```sql
  SELECT * FROM rides WHERE amount > 35.00
  SELECT * FROM rides WHERE user_id = 1001
  SELECT COUNT(*) FROM rides WHERE amount <= 20
  ```
* **Text Exact Match**:
  ```sql
  SELECT * FROM rides WHERE driver = 'Alice'
  ```
* **Text Substring Search (`LIKE`)**:
  * Case-sensitive substring search (matches if text contains string):
  ```sql
  SELECT * FROM demo WHERE message LIKE 'coffee'
  ```

#### 3. Limit Clause
* Appending `LIMIT <n>` halts chunk scanning as soon as `<n>` matching rows are found:
  ```sql
  SELECT * FROM rides WHERE amount > 20 LIMIT 5
  ```

---

### Mode 2: Natural Language Query Rules (SLM)

The SLM parses plain English into verified SQL execution trees. To ensure the SLM resolves your intent, follow these rules:

#### Rule 1: Always Mention the Target Table Name
The SLM must know which table you are searching.
* ✅ `"Total rides where amount > 30"` *(Table 'rides' recognized)*
* ✅ `"Average cost in expenses"` *(Table 'expenses' recognized)*
* ❌ `"What was the highest fare?"` *(Missing table name; returns `UnknownTable` error)*

#### Rule 2: Supported Natural Language Keywords

| Intent | Trigger Words Recognized by SLM | Generated SQL |
| :--- | :--- | :--- |
| **Sum** | `total`, `sum`, `spent` | `SELECT SUM(amount) FROM ...` |
| **Average** | `average`, `avg`, `mean` | `SELECT AVG(amount) FROM ...` |
| **Count** | `how many`, `count`, `number of` | `SELECT COUNT(*) FROM ...` |
| **Max** | `max`, `highest`, `most` | `SELECT MAX(amount) FROM ...` |
| **Min** | `min`, `lowest`, `least` | `SELECT MIN(amount) FROM ...` |
| **All** | Any query without aggregate keywords | `SELECT * FROM ...` |

#### Rule 3: Natural Language Filter Phrasing
Filters must specify the column, a comparison phrase, and a number:
* `amount > 50`
* `cost greater than 30`
* `fare less than 15`
* `rating equals 5`

#### Examples of Working Natural Language Queries:
```text
Total rides where amount > 30
Average spent in rides
Count of orders where amount >= 100
Highest fare in rides
```

---

## 3. Quick Reference Card for End-Users

```
================================================================================
                    SYNAPSEDB QUICK INGESTION CHEAT SHEET
================================================================================

1. LOGGING METRICS / KEY-VALUE:
   Format:  key: value, key2: value2
   Example: temp: 72.5, humidity: 45, status: "nominal"

2. TRANSACTION JSON:
   Format:  {"column": value, ...}
   Example: {"driver": "Bob", "fare": 32.50, "rating": 4.8}

3. MULTI-ROW BATCH (JSON Array):
   Format:  [ {"item": "A", "price": 10}, {"item": "B", "price": 20} ]

4. QUERYING:
   SQL:     SELECT * FROM <table> WHERE <col> > <val>
   SQL:     SELECT SUM(<col>), AVG(<col>) FROM <table>
   SLM NL:  Total <table_name> where <col> > <val>
   SEARCH:  SELECT * FROM <table> WHERE message LIKE '<search_term>'
================================================================================
```
