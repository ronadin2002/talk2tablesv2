import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { ChevronRightIcon, CodeBracketIcon, ChatBubbleLeftIcon, BeakerIcon, TableCellsIcon, ChartBarIcon, Cog6ToothIcon, PlusIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';
import TableConfig from './TableConfig';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

function determineChartType(data) {
  if (!data || data.length === 0) return null;
  
  const columns = Object.keys(data[0]);
  const numericColumns = columns.filter(col => 
    !isNaN(data[0][col]) && typeof data[0][col] !== 'boolean'
  );
  const categoricalColumns = columns.filter(col => 
    isNaN(data[0][col]) || typeof data[0][col] === 'boolean'
  );

  // For time series data
  const possibleDateColumns = categoricalColumns.filter(col =>
    !isNaN(Date.parse(data[0][col]))
  );

  if (possibleDateColumns.length > 0 && numericColumns.length > 0) {
    return { type: 'line', x: possibleDateColumns[0], y: numericColumns[0] };
  }

  // For categorical vs numeric data
  if (categoricalColumns.length > 0 && numericColumns.length > 0) {
    if (data.length <= 10) {
      return { type: 'bar', x: categoricalColumns[0], y: numericColumns[0] };
    } else {
      return { type: 'line', x: categoricalColumns[0], y: numericColumns[0] };
    }
  }

  // For distribution of categories
  if (categoricalColumns.length > 0 && data.length <= 10) {
    const categories = {};
    data.forEach(row => {
      const cat = row[categoricalColumns[0]];
      categories[cat] = (categories[cat] || 0) + 1;
    });
    return { type: 'pie', category: categoricalColumns[0] };
  }

  return null;
}

function DataVisualization({ data, chartInfo }) {
  if (!chartInfo) return null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: 'rgba(255, 255, 255, 0.7)',
          font: {
            size: 12
          }
        }
      },
      title: {
        display: true,
        text: `${chartInfo.y ? chartInfo.y.replace(/_/g, ' ').toUpperCase() : ''} by ${chartInfo.x ? chartInfo.x.replace(/_/g, ' ').toUpperCase() : ''}`,
        color: 'rgba(255, 255, 255, 0.9)',
        font: {
          size: 16
        }
      }
    },
    scales: chartInfo.type !== 'pie' ? {
      x: {
        ticks: {
          color: 'rgba(255, 255, 255, 0.7)',
          font: {
            size: 12
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      },
      y: {
        ticks: {
          color: 'rgba(255, 255, 255, 0.7)',
          font: {
            size: 12
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }
    } : {}
  };

  const getChartData = () => {
    if (chartInfo.type === 'pie') {
      const categories = {};
      data.forEach(row => {
        const cat = row[chartInfo.category];
        categories[cat] = (categories[cat] || 0) + 1;
      });
      return {
        labels: Object.keys(categories),
        datasets: [{
          data: Object.values(categories),
          backgroundColor: [
            'rgba(147, 51, 234, 0.7)',
            'rgba(59, 130, 246, 0.7)',
            'rgba(79, 70, 229, 0.7)',
            'rgba(236, 72, 153, 0.7)',
            'rgba(167, 139, 250, 0.7)',
          ],
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1
        }]
      };
    }

    return {
      labels: data.map(row => row[chartInfo.x]),
      datasets: [{
        label: chartInfo.y.replace(/_/g, ' ').toUpperCase(),
        data: data.map(row => row[chartInfo.y]),
        backgroundColor: 'rgba(147, 51, 234, 0.7)',
        borderColor: 'rgba(147, 51, 234, 1)',
        borderWidth: 1
      }]
    };
  };

  const ChartComponent = {
    'bar': Bar,
    'line': Line,
    'pie': Pie
  }[chartInfo.type];

  return (
    <div className="mt-4 h-[300px] bg-black/30 rounded-lg p-4 border border-purple-500/20">
      <ChartComponent data={getChartData()} options={chartOptions} />
    </div>
  );
}

function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [availableTables, setAvailableTables] = useState([]);
  const [excelTables, setExcelTables] = useState([]);
  const [expandedMessages, setExpandedMessages] = useState(new Set());
  const messagesEndRef = useRef(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    loadTables();
    loadExcelTables();
    scrollToBottom();
  }, []);

  useEffect(() => {
    // Refresh Excel tables list periodically to update expiration times
    const interval = setInterval(loadExcelTables, 30000); // every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadExcelTables = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/excel-tables');
      setExcelTables(response.data.map(table => ({
        name: table.name,
        original_filename: table.original_filename,
        expires_at: table.expires_at,
        selected: false
      })));
    } catch (error) {
      console.error('Error loading Excel tables:', error);
    }
  };

  const loadTables = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/tables');
      setAvailableTables(response.data.map(table => ({
        name: table.name,
        selected: false,
        type: 'postgresql'
      })));
    } catch (error) {
      console.error('Error loading tables:', error);
    }
  };

  const toggleTableSelection = (tableName, isExcel = false) => {
    if (isExcel) {
      setExcelTables(tables => 
        tables.map(table => 
          table.name === tableName 
            ? { ...table, selected: !table.selected }
            : table
        )
      );
    } else {
      setAvailableTables(tables => 
        tables.map(table => 
          table.name === tableName 
            ? { ...table, selected: !table.selected }
            : table
        )
      );
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const selectedPgTables = availableTables
      .filter(table => table.selected)
      .map(table => table.name);

    const selectedExcelTables = excelTables
      .filter(table => table.selected)
      .map(table => table.name);

    const allSelectedTables = [...selectedPgTables, ...selectedExcelTables];

    if (allSelectedTables.length === 0) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: 'Please select at least one table to query.'
      }]);
      return;
    }

    const userMessage = { type: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await axios.post('http://localhost:8000/api/chat', {
        message: input,
        tables: allSelectedTables
      });

      const botMessage = {
        type: 'bot',
        content: response.data.answer,
        sql: response.data.sql_query,
        data: response.data.data,
        showSql: false
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      const errorMessage = {
        type: 'error',
        content: error.response?.data?.detail || 'Sorry, there was an error processing your request.'
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setIsLoading(false);
  };

  const toggleSql = (index) => {
    setMessages(messages.map((msg, i) => {
      if (i === index) {
        return { ...msg, showSql: !msg.showSql };
      }
      return msg;
    }));
  };

  const toggleExpand = (index) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0118] relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -inset-[10px] opacity-50">
          <div className="absolute top-[10%] left-[20%] w-[500px] h-[500px] bg-purple-500 rounded-full mix-blend-multiply filter blur-[128px] animate-blob animation-delay-2000"></div>
          <div className="absolute top-[20%] right-[20%] w-[500px] h-[500px] bg-blue-500 rounded-full mix-blend-multiply filter blur-[128px] animate-blob"></div>
          <div className="absolute bottom-[20%] left-[30%] w-[500px] h-[500px] bg-indigo-500 rounded-full mix-blend-multiply filter blur-[128px] animate-blob animation-delay-4000"></div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="bg-opacity-20 bg-black backdrop-blur-lg border-b border-white/10">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <BeakerIcon className="h-8 w-8 text-purple-400" />
                <div>
                  <h1 className="text-3xl font-bold text-white">Talk2Tables</h1>
                  <p className="text-purple-200/70 text-sm">Chat with your database using natural language</p>
                </div>
              </div>
              <Link
                to="/config"
                className="p-2 text-purple-400 hover:text-purple-300 transition-colors rounded-lg hover:bg-purple-500/20"
                title="Configure Tables"
              >
                <Cog6ToothIcon className="h-6 w-6" />
              </Link>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Table Selection */}
          {(availableTables.length > 0 || excelTables.length > 0) ? (
            <div className="mb-6 bg-opacity-20 bg-black backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <TableCellsIcon className="h-5 w-5 text-purple-400" />
                  <h2 className="text-lg font-medium text-white">Select Tables</h2>
                </div>
                <Link
                  to="/config"
                  className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Configure Tables
                </Link>
              </div>

              {/* PostgreSQL Tables */}
              {availableTables.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-purple-200/70 mb-2">PostgreSQL Tables</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {availableTables.map(table => (
                      <button
                        key={table.name}
                        onClick={() => toggleTableSelection(table.name)}
                        className={`p-3 rounded-xl border transition-all duration-200 ${
                          table.selected
                            ? 'bg-purple-500/30 border-purple-500/50 text-white'
                            : 'bg-black/20 border-white/10 text-purple-200/70 hover:border-purple-500/30'
                        }`}
                      >
                        <div className="text-sm font-medium">{table.name}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Excel Tables */}
              {excelTables.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-purple-200/70 mb-2">Excel Files</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {excelTables.map(table => (
                      <button
                        key={table.name}
                        onClick={() => toggleTableSelection(table.name, true)}
                        className={`p-3 rounded-xl border transition-all duration-200 ${
                          table.selected
                            ? 'bg-purple-500/30 border-purple-500/50 text-white'
                            : 'bg-black/20 border-white/10 text-purple-200/70 hover:border-purple-500/30'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <DocumentArrowUpIcon className="h-4 w-4 text-purple-400" />
                          <div className="text-sm font-medium truncate">{table.original_filename}</div>
                        </div>
                        <div className="text-xs text-purple-200/50 mt-1">
                          Expires in: {Math.round((new Date(table.expires_at) - new Date()) / 60000)}m
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mb-6 bg-opacity-20 bg-black backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-6 text-center py-8">
              <TableCellsIcon className="h-12 w-12 text-purple-400/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-purple-100/70">No Tables Available</h3>
              <p className="text-purple-200/50 text-sm mt-2 mb-4">Configure database tables or upload Excel files to get started</p>
              <Link
                to="/config"
                className="inline-flex items-center px-4 py-2 border border-purple-500/30 text-sm font-medium rounded-xl text-white bg-purple-500/20 hover:bg-purple-500/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400/30 transition-colors"
              >
                <PlusIcon className="h-5 w-5 mr-2" />
                Configure Tables
              </Link>
            </div>
          )}

          {/* Chat Interface */}
          <div className="bg-opacity-20 bg-black backdrop-blur-xl rounded-3xl shadow-2xl min-h-[600px] flex flex-col border border-white/10">
            {/* Messages Area */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              {messages.length === 0 && (
                <div className="text-center py-12">
                  <ChatBubbleLeftIcon className="h-12 w-12 text-purple-400/30 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-purple-100/70">No messages yet</h3>
                  <p className="text-purple-200/50 text-sm mt-2">Start by asking a question about your data</p>
                </div>
              )}
              {messages.map((message, index) => (
                <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] backdrop-blur-md ${
                    message.type === 'user' 
                      ? 'bg-purple-600/40 text-white rounded-2xl rounded-tr-sm border border-purple-500/30' 
                      : message.type === 'error'
                      ? 'bg-red-500/30 text-white rounded-2xl rounded-tl-sm border border-red-500/30'
                      : 'bg-blue-600/20 text-purple-50 rounded-2xl rounded-tl-sm border border-blue-500/30'
                  } p-4 shadow-lg`}>
                    <p className="text-sm md:text-base">{message.content}</p>
                    
                    {message.type === 'bot' && message.data && (
                      <div className="mt-4 space-y-4">
                        <div className="flex items-center space-x-4">
                          <button
                            onClick={() => toggleSql(index)}
                            className="flex items-center space-x-2 text-sm text-purple-200/70 hover:text-white transition-colors"
                          >
                            <CodeBracketIcon className="h-4 w-4" />
                            <span>{message.showSql ? 'Hide SQL' : 'Show SQL'}</span>
                          </button>
                        </div>
                        
                        {message.showSql && (
                          <pre className="mt-2 p-3 bg-black/30 text-purple-200 rounded-lg text-sm overflow-x-auto font-mono border border-purple-500/20">
                            {message.sql}
                          </pre>
                        )}

                        {/* Data Visualization */}
                        <DataVisualization 
                          data={message.data} 
                          chartInfo={determineChartType(message.data)} 
                        />

                        {/* Data Table */}
                        <div className="mt-4 overflow-x-auto">
                          <div className="inline-block min-w-full align-middle">
                            <div className="overflow-hidden border border-purple-500/20 rounded-lg bg-black/20">
                              <table className="min-w-full divide-y divide-purple-500/20">
                                <thead className="bg-black/30">
                                  {message.data.length > 0 && Object.keys(message.data[0]).map((header) => (
                                    <th key={header} className="px-4 py-3 text-left text-xs font-medium text-purple-200/70 uppercase tracking-wider">
                                      {header}
                                    </th>
                                  ))}
                                </thead>
                                <tbody className="divide-y divide-purple-500/20">
                                  {message.data
                                    .slice(0, expandedMessages.has(index) ? undefined : 5)
                                    .map((row, i) => (
                                      <tr key={i} className="hover:bg-white/5 transition-colors">
                                        {Object.values(row).map((cell, j) => (
                                          <td key={j} className="px-4 py-3 whitespace-nowrap text-sm text-purple-100">
                                            {String(cell)}
                                          </td>
                                        ))}
                                      </tr>
                                  ))}
                                </tbody>
                              </table>
                              {message.data.length > 5 && (
                                <div className="p-2 bg-black/40 border-t border-purple-500/20">
                                  <button
                                    onClick={() => toggleExpand(index)}
                                    className="w-full py-2 px-4 text-sm text-purple-200/70 hover:text-white transition-colors flex items-center justify-center space-x-2"
                                  >
                                    <span>
                                      {expandedMessages.has(index) 
                                        ? 'Show Less' 
                                        : `Show All ${message.data.length} Results`}
                                    </span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-white/10 p-4 bg-black/20 rounded-b-3xl backdrop-blur-md">
              <form onSubmit={handleSubmit} className="flex space-x-4">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question about your data..."
                  className="flex-1 bg-white/5 text-purple-100 rounded-xl px-4 py-2 border border-purple-500/30 focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 focus:outline-none placeholder-purple-300/30 backdrop-blur-sm"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex items-center px-4 py-2 border border-purple-500/30 text-sm font-medium rounded-xl text-white bg-purple-500/20 hover:bg-purple-500/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors backdrop-blur-sm"
                >
                  <ChevronRightIcon className="h-5 w-5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/config" element={<TableConfig />} />
      </Routes>
    </Router>
  );
}

export default App; 