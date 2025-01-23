from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import openai
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text, inspect
import json
import logging
import pandas as pd
from io import BytesIO
import uuid
from datetime import datetime, timedelta
import re

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL")
logger.debug(f"Database URL: {DATABASE_URL}")
engine = create_engine(DATABASE_URL)

# OpenAI configuration
openai.api_key = os.getenv("OPENAI_API_KEY")

def get_table_schema(table_name: str) -> str:
    """Get the schema of a specific table."""
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)
    column_descriptions = []
    for col in columns:
        name = col["name"]
        type_ = str(col["type"])  # Convert SQLAlchemy type to string
        column_descriptions.append(f"{name} ({type_})")
    return f"Table '{table_name}' with columns: {', '.join(column_descriptions)}"

def get_sample_data(table_name: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Get sample data from a table."""
    with engine.connect() as connection:
        result = connection.execute(text(f"SELECT * FROM {table_name} LIMIT {limit}"))
        return [dict(row._mapping) for row in result]

def generate_table_description(table_name: str, columns: List[Dict], sample_data: List[Dict]) -> str:
    """Generate a natural language description of the table using GPT."""
    try:
        schema_info = "\n".join([f"- {col['name']} ({col['type']})" for col in columns])
        sample_data_str = json.dumps(sample_data[:3], indent=2)
        
        prompt = f"""Analyze this database table and provide a detailed description:

Table Name: {table_name}

Columns:
{schema_info}

Sample Data:
{sample_data_str}

Please provide:
1. The purpose of this table
2. Description of key columns
3. Any patterns or insights from the sample data
4. Potential use cases for querying this table

Keep the description clear and concise."""

        completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a database expert that explains table structures and data patterns in clear, concise language."},
                {"role": "user", "content": prompt}
            ]
        )
        
        return completion.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Error generating table description: {str(e)}")
        return "Description generation failed. Please add a manual description."

class TableInfo(BaseModel):
    name: str
    columns: List[Dict[str, Any]]
    description: str
    sample_data: List[Dict[str, Any]]

class TableUpdate(BaseModel):
    description: str

class TableCreate(BaseModel):
    table_name: str

class ExcelTableInfo(BaseModel):
    name: str
    columns: List[str]
    preview_data: List[Dict[str, Any]]

def clean_column_name(col: str) -> str:
    """Clean column name to make it SQL-safe."""
    # Replace special characters and spaces with underscore
    cleaned = ''.join(c if c.isalnum() else '_' for c in col)
    # Remove consecutive underscores
    cleaned = '_'.join(filter(None, cleaned.split('_')))
    # Ensure it doesn't start with a number
    if cleaned[0].isdigit():
        cleaned = 'n_' + cleaned
    return cleaned.lower()

class ExcelTableManager:
    def __init__(self, ttl_minutes: int = 30):
        self.tables: Dict[str, Dict[str, Any]] = {}
        self.ttl_minutes = ttl_minutes
        self.column_mappings: Dict[str, Dict[str, str]] = {}  # Store original to clean column mappings

    def add_table(self, df: pd.DataFrame, original_filename: str, description: str) -> str:
        # Generate unique table name
        table_id = str(uuid.uuid4())[:8]
        safe_filename = ''.join(e for e in original_filename if e.isalnum())
        table_name = f"excel_{safe_filename}_{table_id}"
        
        # Clean column names and store mappings
        original_columns = list(df.columns)
        column_mapping = {col: clean_column_name(col) for col in original_columns}
        self.column_mappings[table_name] = column_mapping
        
        # Rename DataFrame columns
        df.columns = [column_mapping[col] for col in df.columns]
        
        # Store table info
        self.tables[table_name] = {
            'data': df,
            'expires_at': datetime.now() + timedelta(minutes=self.ttl_minutes),
            'original_filename': original_filename,
            'columns': original_columns,  # Store original column names for display
            'clean_columns': list(df.columns),  # Store cleaned column names for queries
            'description': description
        }
        
        return table_name

    def get_table(self, table_name: str) -> Optional[pd.DataFrame]:
        if table_name in self.tables:
            table_info = self.tables[table_name]
            if datetime.now() < table_info['expires_at']:
                return table_info['data']
            else:
                del self.tables[table_name]
                if table_name in self.column_mappings:
                    del self.column_mappings[table_name]
        return None

    def get_column_mapping(self, table_name: str) -> Dict[str, str]:
        """Get the original to clean column name mapping for a table."""
        return self.column_mappings.get(table_name, {})

    def get_all_tables(self) -> List[Dict[str, Any]]:
        current_time = datetime.now()
        # Clean up expired tables
        expired_tables = [name for name, info in self.tables.items() 
                         if current_time >= info['expires_at']]
        for name in expired_tables:
            del self.tables[name]
            if name in self.column_mappings:
                del self.column_mappings[name]
        
        return [
            {
                'name': name,
                'original_filename': info['original_filename'],
                'columns': info['columns'],  # Original column names for display
                'clean_columns': info['clean_columns'],  # Clean column names for queries
                'expires_at': info['expires_at'].isoformat(),
                'description': info['description']
            }
            for name, info in self.tables.items()
        ]

    def remove_table(self, table_name: str) -> bool:
        if table_name in self.tables:
            del self.tables[table_name]
            if table_name in self.column_mappings:
                del self.column_mappings[table_name]
            return True
        return False

# Initialize Excel table manager
excel_manager = ExcelTableManager()

def create_metadata_table(connection):
    """Create metadata table with proper permissions."""
    try:
        # First try to create the table
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS table_metadata (
                table_name TEXT PRIMARY KEY,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        # Grant permissions
        connection.execute(text("""
            GRANT ALL PRIVILEGES ON TABLE table_metadata TO current_user;
        """))
        
        connection.commit()
        return True
    except Exception as e:
        logger.warning(f"Could not create metadata table: {str(e)}")
        return False

def get_metadata_storage():
    """Get a dictionary to store metadata if table creation fails."""
    return getattr(get_metadata_storage, 'storage', {})

def set_metadata_storage(data):
    """Set metadata in memory storage."""
    get_metadata_storage.storage = data

@app.get("/api/available-tables")
async def get_available_tables():
    """Get all tables from the database."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        return {"tables": tables}
    except Exception as e:
        logger.error(f"Error getting available tables: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tables")
async def get_tables():
    """Get all configured tables with their schemas and descriptions."""
    try:
        inspector = inspect(engine)
        tables = []
        metadata_dict = {}
        
        # Try to get metadata from table
        try:
            with engine.connect() as connection:
                result = connection.execute(text("SELECT table_name, description FROM table_metadata"))
                metadata_dict = {row.table_name: row.description for row in result}
        except:
            # If table access fails, use in-memory storage
            metadata_dict = get_metadata_storage()
        
        # Get details only for configured tables
        for table_name in inspector.get_table_names():
            if table_name in metadata_dict:
                # Convert SQLAlchemy column types to strings
                columns = [
                    {
                        "name": col["name"],
                        "type": str(col["type"]),
                        "nullable": col["nullable"],
                        "default": str(col["default"]) if col["default"] is not None else None,
                    }
                    for col in inspector.get_columns(table_name)
                ]
                
                sample_data = get_sample_data(table_name)
                
                tables.append(TableInfo(
                    name=table_name,
                    columns=columns,
                    description=metadata_dict[table_name],
                    sample_data=sample_data
                ))
        
        return tables
    except Exception as e:
        logger.error(f"Error getting tables: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tables")
async def add_table(table: TableCreate):
    """Add a new table to the configuration."""
    try:
        # Verify table exists
        inspector = inspect(engine)
        if table.table_name not in inspector.get_table_names():
            raise HTTPException(status_code=404, detail=f"Table {table.table_name} not found in database")
        
        description = "Analyzing table structure..."
        metadata_dict = get_metadata_storage()
        
        # Try to use the database table first
        try:
            with engine.connect() as connection:
                # Try to create metadata table if it doesn't exist
                created = create_metadata_table(connection)
                
                if created:
                    # If table exists and we have access, use it
                    connection.execute(
                        text("INSERT INTO table_metadata (table_name, description) VALUES (:table, :desc)"),
                        {"table": table.table_name, "desc": description}
                    )
                    connection.commit()
                else:
                    # If we can't use the table, use in-memory storage
                    metadata_dict[table.table_name] = description
                    set_metadata_storage(metadata_dict)
        except:
            # If database operations fail, use in-memory storage
            metadata_dict[table.table_name] = description
            set_metadata_storage(metadata_dict)
        
        # Generate the description asynchronously
        columns = [
            {
                "name": col["name"],
                "type": str(col["type"]),
                "nullable": col["nullable"],
                "default": str(col["default"]) if col["default"] is not None else None,
            }
            for col in inspector.get_columns(table.table_name)
        ]
        sample_data = get_sample_data(table.table_name)
        description = generate_table_description(table.table_name, columns, sample_data)
        
        # Try to update the description in the database
        try:
            with engine.connect() as connection:
                connection.execute(
                    text("UPDATE table_metadata SET description = :desc WHERE table_name = :table"),
                    {"desc": description, "table": table.table_name}
                )
                connection.commit()
        except:
            # If database update fails, update in-memory storage
            metadata_dict[table.table_name] = description
            set_metadata_storage(metadata_dict)
        
        return {"message": "Table added successfully", "description": description}
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error adding table: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/tables/{table_name}")
async def remove_table(table_name: str):
    """Remove a table from the configuration."""
    try:
        metadata_dict = get_metadata_storage()
        
        # Try database first
        try:
            with engine.connect() as connection:
                connection.execute(
                    text("DELETE FROM table_metadata WHERE table_name = :table"),
                    {"table": table_name}
                )
                connection.commit()
        except:
            # If database fails, remove from in-memory storage
            if table_name in metadata_dict:
                del metadata_dict[table_name]
                set_metadata_storage(metadata_dict)
        
        return {"message": "Table removed successfully"}
    except Exception as e:
        logger.error(f"Error removing table: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/tables/{table_name}")
async def update_table(table_name: str, update: TableUpdate):
    """Update table description."""
    try:
        metadata_dict = get_metadata_storage()
        
        # Try database first
        try:
            with engine.connect() as connection:
                connection.execute(
                    text("UPDATE table_metadata SET description = :desc WHERE table_name = :table"),
                    {"desc": update.description, "table": table_name}
                )
                connection.commit()
        except:
            # If database fails, update in-memory storage
            metadata_dict[table_name] = update.description
            set_metadata_storage(metadata_dict)
        
        return {"message": "Table updated successfully"}
    except Exception as e:
        logger.error(f"Error updating table: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class ChatRequest(BaseModel):
    message: str
    tables: List[str]

class ChatResponse(BaseModel):
    answer: str
    sql_query: str
    data: List[dict]

@app.post("/api/chat", response_model=ChatResponse)
async def chat_with_table(request: ChatRequest):
    try:
        logger.debug(f"Received message: {request.message}")
        
        # Separate PostgreSQL and Excel tables
        excel_tables = [t for t in request.tables if t.startswith("excel_")]
        pg_tables = [t for t in request.tables if not t.startswith("excel_")]
        
        # Get schema information for all tables
        table_schemas = []
        available_tables = []
        column_mappings = {}  # Store column mappings for all tables
        
        # Add PostgreSQL table schemas
        for table in pg_tables:
            try:
                schema = get_table_schema(table)
                table_schemas.append(schema)
                available_tables.append(table)
            except Exception as e:
                logger.error(f"Error getting schema for PostgreSQL table {table}: {str(e)}")
                continue
        
        # Add Excel table schemas with cleaned column names
        for table_name in excel_tables:
            df = excel_manager.get_table(table_name)
            if df is not None:
                table_info = next((t for t in excel_manager.get_all_tables() if t['name'] == table_name), None)
                if table_info:
                    # Get column mapping for this table
                    mapping = excel_manager.get_column_mapping(table_name)
                    column_mappings[table_name] = mapping
                    
                    # Create schema with cleaned column names
                    schema = f"Table: {table_name} (Excel)\nColumns:\n"
                    for col in table_info['columns']:
                        clean_col = mapping[col]  # Get cleaned column name
                        dtype = str(df[clean_col].dtype)
                        # Show both original and cleaned names in schema
                        schema += f"- {clean_col} (was: {col}) ({dtype})\n"
                    table_schemas.append(schema)
                    available_tables.append(table_name)
        
        if not available_tables:
            raise HTTPException(status_code=400, detail="No valid tables available for querying")
        
        schema_info = "\n".join(table_schemas)
        
        # Generate SQL query using OpenAI with improved prompt
        completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": f"""You are a SQL expert. Generate only the SQL query without any explanation.
                Available tables and their schemas:
                {schema_info}
                
                Rules:
                1. Use proper SQL syntax
                2. Ensure the query is safe
                3. Use JOIN operations when querying multiple tables
                4. Use table aliases for better readability
                5. ONLY use the tables that are provided above - do not reference any tables not listed
                6. For Excel tables (starting with 'excel_'), treat them as regular SQL tables
                7. Use the EXACT column names as shown in the schema (the cleaned names, not the original ones)
                8. If the question can't be answered with the available tables and columns, return 'ERROR: Cannot answer this question with the selected tables'
                9. Do not assume any columns exist that are not explicitly shown in the schema
                10. Do not assume any relationships between tables unless explicitly stated in the question
                11. For Excel tables, use the cleaned column names (shown before 'was:' in the schema)"""},
                {"role": "user", "content": f"Using ONLY the tables listed above ({', '.join(available_tables)}), {request.message}"}
            ]
        )
        
        sql_query = completion.choices[0].message.content.strip()
        logger.debug(f"Generated SQL query: {sql_query}")
        
        if sql_query.startswith("ERROR:"):
            raise HTTPException(status_code=400, detail=sql_query)
        
        # Execute query and combine results
        try:
            if excel_tables:
                # If we have Excel tables, execute in pandas
                result_data = execute_mixed_query(sql_query, pg_tables, excel_tables)
            else:
                # If only PostgreSQL tables, execute normally
                with engine.connect() as connection:
                    result = connection.execute(text(sql_query))
                    result_data = [dict(row._mapping) for row in result]
            
            if not result_data:
                result_data = []  # Ensure we always return a list
            
            logger.debug(f"Query results: {result_data}")
        except Exception as e:
            logger.error(f"Error executing query: {str(e)}")
            # Generate a more user-friendly error message
            error_msg = str(e)
            if "no such column" in error_msg.lower():
                # Extract the column name from the error message
                col_match = re.search(r'no such column: ([^\s]+)', error_msg, re.IGNORECASE)
                if col_match:
                    bad_col = col_match.group(1)
                    # Try to find the original column name
                    for table_name, mapping in column_mappings.items():
                        reverse_mapping = {v: k for k, v in mapping.items()}
                        if bad_col in reverse_mapping:
                            error_msg = f"Please use '{clean_column_name(reverse_mapping[bad_col])}' instead of '{bad_col}'"
                            break
                        elif bad_col in mapping:
                            error_msg = f"Please use '{mapping[bad_col]}' instead of '{bad_col}'"
                            break
            raise HTTPException(status_code=400, detail=error_msg)
        
        # Generate natural language response
        response_prompt = f"""Based on the following SQL query and its results, provide a natural language summary:
        Query: {sql_query}
        Results: {json.dumps(result_data[:5])} {'...' if len(result_data) > 5 else ''}
        Number of results: {len(result_data)}"""
        
        completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that explains SQL query results in natural language. Be concise but informative."},
                {"role": "user", "content": response_prompt}
            ]
        )
        
        answer = completion.choices[0].message.content.strip()
        
        return ChatResponse(
            answer=answer,
            sql_query=sql_query,
            data=result_data
        )
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

def clean_dataframe_for_json(df: pd.DataFrame) -> pd.DataFrame:
    """Clean DataFrame to ensure JSON serialization compatibility."""
    df = df.copy()
    
    # Handle datetime columns
    datetime_cols = df.select_dtypes(include=['datetime64[ns]']).columns
    for col in datetime_cols:
        df[col] = df[col].apply(lambda x: x.isoformat() if pd.notnull(x) else None)
    
    # Handle float columns (replace NaN, Inf with None)
    float_cols = df.select_dtypes(include=['float64', 'float32']).columns
    for col in float_cols:
        df[col] = df[col].apply(lambda x: None if pd.isna(x) or pd.isinf(x) else x)
    
    return df

def clean_sample_data_for_json(data: List[Dict]) -> List[Dict]:
    """Clean sample data to ensure JSON serialization compatibility."""
    cleaned_data = []
    for row in data:
        cleaned_row = {}
        for key, value in row.items():
            if isinstance(value, datetime):
                cleaned_row[key] = value.isoformat()
            elif isinstance(value, float) and (pd.isna(value) or pd.isinf(value)):
                cleaned_row[key] = None
            else:
                cleaned_row[key] = value
        cleaned_data.append(cleaned_row)
    return cleaned_data

def execute_mixed_query(sql_query: str, pg_tables: List[str], excel_tables: List[str]) -> List[Dict]:
    """Execute a query that might involve both PostgreSQL and Excel tables."""
    try:
        # Create a temporary SQLite database in memory
        import sqlite3
        conn = sqlite3.connect(':memory:')
        
        # First, clean up the SQL query to handle column names
        cleaned_query = sql_query
        for table_name in excel_tables:
            column_mapping = excel_manager.get_column_mapping(table_name)
            if column_mapping:
                # Sort by length in descending order to replace longer names first
                for orig_col, clean_col in sorted(column_mapping.items(), key=lambda x: len(x[0]), reverse=True):
                    # Replace exact column matches
                    cleaned_query = cleaned_query.replace(f'"{orig_col}"', clean_col)
                    cleaned_query = cleaned_query.replace(f"'{orig_col}'", clean_col)
                    cleaned_query = cleaned_query.replace(f" {orig_col} ", f" {clean_col} ")
                    cleaned_query = cleaned_query.replace(f"({orig_col} ", f"({clean_col} ")
                    cleaned_query = cleaned_query.replace(f" {orig_col})", f" {clean_col})")
                    cleaned_query = cleaned_query.replace(f",{orig_col} ", f",{clean_col} ")
                    cleaned_query = cleaned_query.replace(f" {orig_col},", f" {clean_col},")
        
        logger.debug(f"Original query: {sql_query}")
        logger.debug(f"Cleaned query: {cleaned_query}")
        
        # Load Excel tables into SQLite
        for table_name in excel_tables:
            df = excel_manager.get_table(table_name)
            if df is not None:
                # Clean the DataFrame before loading into SQLite
                cleaned_df = clean_dataframe_for_json(df)
                cleaned_df.to_sql(table_name, conn, index=False)
        
        # Load PostgreSQL tables into SQLite if they're used in the query
        with engine.connect() as pg_conn:
            for table_name in pg_tables:
                if table_name in cleaned_query:
                    pg_data = pd.read_sql(f"SELECT * FROM {table_name}", pg_conn)
                    # Clean the DataFrame before loading into SQLite
                    cleaned_pg_data = clean_dataframe_for_json(pg_data)
                    cleaned_pg_data.to_sql(table_name, conn, index=False)
        
        # Execute the cleaned query in SQLite
        result = pd.read_sql_query(cleaned_query, conn)
        
        # Clean the result DataFrame
        result = clean_dataframe_for_json(result)
        
        # Rename columns back to original names in the result
        reverse_mappings = {}
        for table_name in excel_tables:
            column_mapping = excel_manager.get_column_mapping(table_name)
            reverse_mappings.update({v: k for k, v in column_mapping.items()})
        
        result.columns = [reverse_mappings.get(col, col) for col in result.columns]
        return result.to_dict('records')
        
    except Exception as e:
        logger.error(f"Error executing mixed query: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error executing query: {str(e)}")

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

def process_excel_file(file_contents: bytes) -> ExcelTableInfo:
    """Process an Excel file and return its structure and preview data."""
    try:
        # Read Excel file into pandas DataFrame
        df = pd.read_excel(BytesIO(file_contents))
        
        # Get column names
        columns = df.columns.tolist()
        
        # Get preview data (first 5 rows)
        preview_data = df.head(5).to_dict('records')
        
        # Generate a name for the Excel table
        name = "excel_data"
        
        return ExcelTableInfo(
            name=name,
            columns=columns,
            preview_data=preview_data
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing Excel file: {str(e)}")

@app.post("/api/upload-excel", response_model=ExcelTableInfo)
async def upload_excel(file: UploadFile = File(...)):
    """Upload and process an Excel file."""
    try:
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents))
        
        # Clean the DataFrame for JSON serialization
        cleaned_df = clean_dataframe_for_json(df)
        
        # Generate description using the same process as PostgreSQL tables
        columns = [{"name": col, "type": str(df[col].dtype)} for col in df.columns]
        sample_data = clean_sample_data_for_json(cleaned_df.head(5).to_dict('records'))
        description = generate_table_description(file.filename, columns, sample_data)
        
        # Add table to manager with description
        table_name = excel_manager.add_table(df, file.filename, description)
        
        return ExcelTableInfo(
            name=table_name,
            columns=list(df.columns),
            preview_data=sample_data
        )
    except Exception as e:
        logger.error(f"Error processing Excel file: {str(e)}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Error processing Excel file: {str(e)}")

@app.get("/api/excel-tables")
async def get_excel_tables():
    """Get all active Excel tables."""
    try:
        return excel_manager.get_all_tables()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/excel-tables/{table_name}")
async def remove_excel_table(table_name: str):
    """Remove an Excel table."""
    if excel_manager.remove_table(table_name):
        # Also remove from metadata storage
        metadata_dict = get_metadata_storage()
        if table_name in metadata_dict:
            del metadata_dict[table_name]
            set_metadata_storage(metadata_dict)
        return {"message": "Table removed successfully"}
    raise HTTPException(status_code=404, detail="Table not found") 