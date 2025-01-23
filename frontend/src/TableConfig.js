import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ArrowLeftIcon, PlusIcon, TrashIcon, PencilIcon, TableCellsIcon, ChevronUpDownIcon, DocumentArrowUpIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import ReactDOM from 'react-dom';

function CustomDropdown({ options, value, onChange, disabled, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef} style={{ isolation: 'isolate' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`relative w-full flex items-center justify-between bg-white/5 text-purple-100 rounded-xl px-4 py-2 border ${
          isOpen ? 'border-purple-400 ring-2 ring-purple-400/20' : 'border-purple-500/30'
        } focus:outline-none transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-purple-400/50'}`}
      >
        <span className={value ? 'text-purple-100' : 'text-purple-300/50'}>
          {value || placeholder}
        </span>
        <ChevronUpDownIcon className="h-5 w-5 text-purple-300" />
      </button>

      {isOpen && !disabled && (
        <Portal>
          <div 
            className="fixed inset-0" 
            style={{ zIndex: 9999 }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setIsOpen(false);
              }
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: buttonRef.current?.getBoundingClientRect().bottom + 8,
                left: buttonRef.current?.getBoundingClientRect().left,
                width: buttonRef.current?.offsetWidth,
                zIndex: 10000,
              }}
              className="bg-[#1a0b2e] border border-purple-500/30 rounded-xl shadow-xl backdrop-blur-xl"
            >
              <div className="max-h-60 overflow-auto py-1">
                {options.map((option) => (
                  <button
                    key={option}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onChange(option);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-purple-500/20 focus:outline-none focus:bg-purple-500/20 transition-colors ${
                      option === value ? 'text-purple-100 bg-purple-500/20' : 'text-purple-200/70'
                    }`}
                  >
                    {option}
                  </button>
                ))}
                {options.length === 0 && (
                  <div className="px-4 py-2 text-sm text-purple-200/50">
                    No tables available
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// Add Portal component for rendering dropdown outside current DOM hierarchy
function Portal({ children }) {
  const [mounted, setMounted] = useState(false);
  const portalRef = useRef(null);

  useEffect(() => {
    const portalRoot = document.createElement('div');
    document.body.appendChild(portalRoot);
    portalRef.current = portalRoot;
    setMounted(true);

    return () => {
      if (portalRoot) {
        document.body.removeChild(portalRoot);
      }
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return ReactDOM.createPortal(children, portalRef.current);
}

function TableConfig() {
  const [tables, setTables] = useState([]);
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStates, setLoadingStates] = useState({});
  const [addingTable, setAddingTable] = useState(false);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [error, setError] = useState(null);
  const [excelTables, setExcelTables] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadTables();
    loadAvailableTables();
    loadExcelTables();
  }, []);

  const loadExcelTables = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/excel-tables');
      setExcelTables(response.data);
    } catch (error) {
      console.error('Error loading Excel tables:', error);
    }
  };

  const loadAvailableTables = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/available-tables');
      setAvailableTables(response.data.tables);
    } catch (error) {
      console.error('Error loading available tables:', error);
    }
  };

  const loadTables = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/tables');
      setTables(response.data);
      // Update loading states for existing tables
      const newLoadingStates = {};
      response.data.forEach(table => {
        newLoadingStates[table.name] = table.description === "Analyzing table structure...";
      });
      setLoadingStates(newLoadingStates);
    } catch (error) {
      console.error('Error loading tables:', error);
    }
  };

  // Poll for updates while tables are being analyzed
  useEffect(() => {
    const hasLoadingTables = Object.values(loadingStates).some(state => state);
    if (hasLoadingTables) {
      const interval = setInterval(loadTables, 2000);
      return () => clearInterval(interval);
    }
  }, [loadingStates]);

  const addTable = async () => {
    if (!selectedTable) return;
    setAddingTable(true);
    try {
      await axios.post('http://localhost:8000/api/tables', { table_name: selectedTable });
      setSelectedTable('');
      setLoadingStates(prev => ({ ...prev, [selectedTable]: true }));
      await loadTables();
    } catch (error) {
      console.error('Error adding table:', error);
    }
    setAddingTable(false);
  };

  const deleteTable = async (tableName) => {
    if (!window.confirm(`Are you sure you want to remove ${tableName} from the configuration?`)) return;
    try {
      await axios.delete(`http://localhost:8000/api/tables/${tableName}`);
      await loadTables();
      await loadAvailableTables();
    } catch (error) {
      console.error('Error deleting table:', error);
    }
  };

  const updateTableDescription = async (tableName, description) => {
    try {
      await axios.put(`http://localhost:8000/api/tables/${tableName}`, { description });
      await loadTables();
    } catch (error) {
      console.error('Error updating table description:', error);
    }
  };

  // Filter out tables that are already configured
  const availableUnconfiguredTables = availableTables.filter(
    table => !tables.some(configuredTable => configuredTable.name === table)
  );

  const handleExcelUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadingExcel(true);
    setError(null);

    try {
      const response = await axios.post('http://localhost:8000/api/upload-excel', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      await loadExcelTables();
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Error uploading Excel file');
    } finally {
      setUploadingExcel(false);
    }
  };

  const deleteExcelTable = async (tableName) => {
    if (!window.confirm(`Are you sure you want to remove this Excel table?`)) return;
    try {
      await axios.delete(`http://localhost:8000/api/excel-tables/${tableName}`);
      await loadExcelTables();
    } catch (error) {
      console.error('Error deleting Excel table:', error);
    }
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
                <Link to="/" className="text-purple-400 hover:text-purple-300 transition-colors">
                  <ArrowLeftIcon className="h-6 w-6" />
                </Link>
                <h1 className="text-3xl font-bold text-white">Table Configuration</h1>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* PostgreSQL Tables Section */}
          <div className="mb-8 bg-opacity-20 bg-black backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-6">
            <h2 className="text-xl font-medium text-white mb-4">PostgreSQL Tables</h2>
            <div className="flex space-x-4 mb-6">
              <div className="flex-1">
                <CustomDropdown
                  options={availableUnconfiguredTables}
                  value={selectedTable}
                  onChange={setSelectedTable}
                  disabled={addingTable}
                  placeholder="Select a table..."
                />
              </div>
              <button
                onClick={addTable}
                disabled={addingTable || !selectedTable}
                className="inline-flex items-center px-4 py-2 border border-purple-500/30 text-sm font-medium rounded-xl text-white bg-purple-500/20 hover:bg-purple-500/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors relative"
              >
                {addingTable ? (
                  <>
                    <div className="flex items-center">
                      <div className="w-5 h-5 border-t-2 border-purple-400 border-solid rounded-full animate-spin mr-2"></div>
                      Adding...
                    </div>
                  </>
                ) : (
                  <>
                    <PlusIcon className="h-5 w-5 mr-2" />
                    Add Table
                  </>
                )}
              </button>
            </div>

            {/* Existing PostgreSQL Tables List */}
            <div className="space-y-4">
              {tables.map((table) => (
                <div
                  key={table.name}
                  className="bg-opacity-20 bg-black backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-6"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-white">{table.name}</h3>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => deleteTable(table.name)}
                        className="p-2 text-red-400/70 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/20"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Schema Information */}
                  <div className="space-y-4">
                    <div className="bg-black/30 rounded-lg p-4 border border-purple-500/20">
                      <h4 className="text-sm font-medium text-purple-200/70 mb-2">Columns</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {table.columns.map((column) => (
                          <div key={column.name} className="text-purple-100">
                            <span className="font-mono text-sm">{column.name}</span>
                            <span className="text-purple-300/50 text-xs ml-2">({column.type})</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-black/30 rounded-lg p-4 border border-purple-500/20">
                      <h4 className="text-sm font-medium text-purple-200/70 mb-2">Description</h4>
                      {loadingStates[table.name] ? (
                        <div className="space-y-2">
                          <div className="animate-pulse space-y-2">
                            <div className="h-4 bg-purple-500/20 rounded w-3/4"></div>
                            <div className="h-4 bg-purple-500/20 rounded w-1/2"></div>
                            <div className="h-4 bg-purple-500/20 rounded w-2/3"></div>
                          </div>
                          <div className="text-purple-200/70 text-sm mt-4 space-y-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-400 rounded-full animate-ping"></div>
                              <span>Analyzing table structure...</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-400 rounded-full animate-ping" style={{ animationDelay: '0.2s' }}></div>
                              <span>Examining column types...</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-400 rounded-full animate-ping" style={{ animationDelay: '0.4s' }}></div>
                              <span>Inspecting sample data...</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-400 rounded-full animate-ping" style={{ animationDelay: '0.6s' }}></div>
                              <span>Generating insights...</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-purple-100 text-sm whitespace-pre-line">{table.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Excel Files Section */}
          <div className="mb-8 bg-opacity-20 bg-black backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-6">
            <h2 className="text-xl font-medium text-white mb-4">Excel Files</h2>
            <div className="flex space-x-4 mb-6">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleExcelUpload}
                accept=".xlsx,.xls"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingExcel}
                className="inline-flex items-center px-4 py-2 border border-purple-500/30 text-sm font-medium rounded-xl text-white bg-purple-500/20 hover:bg-purple-500/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <DocumentArrowUpIcon className="h-5 w-5 mr-2" />
                {uploadingExcel ? 'Uploading...' : 'Upload Excel'}
              </button>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-100">
                {error}
              </div>
            )}

            {/* Excel Tables List */}
            <div className="space-y-4">
              {excelTables.map((table) => (
                <div
                  key={table.name}
                  className="bg-opacity-20 bg-black backdrop-blur-xl rounded-xl shadow-xl border border-white/10 p-4"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-white flex items-center">
                        <DocumentArrowUpIcon className="h-5 w-5 mr-2 text-purple-400" />
                        {table.original_filename}
                      </h3>
                      <p className="text-sm text-purple-200/50">Expires: {new Date(table.expires_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => deleteExcelTable(table.name)}
                      className="p-2 text-red-400/70 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/20"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Schema Information */}
                  <div className="space-y-4">
                    <div className="bg-black/30 rounded-lg p-4 border border-purple-500/20">
                      <h4 className="text-sm font-medium text-purple-200/70 mb-2">Columns</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {table.columns.map((column) => (
                          <div key={column} className="text-purple-100">
                            <span className="font-mono text-sm">{column}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-black/30 rounded-lg p-4 border border-purple-500/20">
                      <h4 className="text-sm font-medium text-purple-200/70 mb-2">Description</h4>
                      <p className="text-purple-100 text-sm whitespace-pre-line">{table.description}</p>
                    </div>
                  </div>
                </div>
              ))}

              {excelTables.length === 0 && (
                <div className="text-center py-6">
                  <DocumentArrowUpIcon className="h-12 w-12 text-purple-400/30 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-purple-100/70">No Excel Files</h3>
                  <p className="text-purple-200/50 text-sm mt-2">Upload Excel files to query them alongside your database tables</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TableConfig; 