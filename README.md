# Talk2Tables

A modern web application that allows you to chat with your PostgreSQL database using natural language. Ask questions about your data in plain English, and get instant responses with the relevant data and the underlying SQL queries.

## Features

- 🗣️ Natural language interface to your database
- 🔍 View the generated SQL queries
- 📊 Beautiful data presentation
- 💫 Modern, responsive UI
- 🔒 Secure database connection

## Prerequisites

- Python 3.8+
- Node.js 14+
- PostgreSQL database
- OpenAI API key

## Setup

1. Clone the repository
2. Set up the backend:
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: .\venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Set up the frontend:
   ```bash
   cd frontend
   npm install
   ```

4. Create a `.env` file in the root directory with your configuration:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/database_name
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## Running the Application

1. Start the backend:
   ```bash
   cd backend
   uvicorn main:app --reload
   ```

2. Start the frontend (in a new terminal):
   ```bash
   cd frontend
   npm start
   ```

3. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Type your question in natural language in the chat input
2. The application will generate and execute the appropriate SQL query
3. View the results in a clean, tabular format
4. Click the "Show SQL" button to see the generated query

## Security Notes

- Never commit your `.env` file
- Ensure your database connection is secure
- Consider implementing authentication for production use 