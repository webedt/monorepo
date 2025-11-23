import { useState } from 'react';
import SessionLayout from '@/components/SessionLayout';

type FileNode = {
  name: string;
  type: 'file';
  icon: string;
};

type FolderNode = {
  name: string;
  type: 'folder';
  children: TreeNode[];
};

type TreeNode = FileNode | FolderNode;

export default function Code() {
  const [selectedFile, setSelectedFile] = useState('Button.jsx');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src', 'components']));

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const fileTree: FolderNode = {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'components',
        type: 'folder',
        children: [
          { name: 'Button.jsx', type: 'file', icon: '🔵' },
          { name: 'Card.jsx', type: 'file', icon: '🔵' }
        ]
      },
      {
        name: 'styles',
        type: 'folder',
        children: []
      },
      { name: 'App.js', type: 'file', icon: 'JS' },
      { name: 'index.css', type: 'file', icon: 'CSS' },
      { name: 'package.json', type: 'file', icon: '📦' },
      { name: 'README.md', type: 'file', icon: '📄' }
    ]
  };

  const exampleCode = `import React from 'react';

// A simple button component
const Button = ({ children, onClick, type = 'button' }) => {
  const baseStyles = 'px-4 py-2 rounded font-semibold';
  const typeStyles = 'bg-primary text-white hover:bg-primary/90';
  return (
    <button
      type={type}
      onClick={onClick}
      className={\`\${baseStyles} \${typeStyles}\`}
    >
      {children}
    </button>
  );
};

export default Button;`;

  const renderFileTree = (node: TreeNode, level = 0): JSX.Element | JSX.Element[] => {
    const paddingLeft = level * 16 + 8;

    if (node.type === 'file') {
      return (
        <div
          key={node.name}
          onClick={() => setSelectedFile(node.name)}
          className={`flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
            selectedFile === node.name ? 'bg-base-300' : ''
          }`}
          style={{ paddingLeft }}
        >
          <span className="text-xs">{node.icon}</span>
          <span className="text-sm">{node.name}</span>
        </div>
      );
    }

    const isExpanded = expandedFolders.has(node.name);
    return (
      <div key={node.name}>
        <div
          onClick={() => toggleFolder(node.name)}
          className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300"
          style={{ paddingLeft }}
        >
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium">{node.name}</span>
        </div>
        {isExpanded && node.children?.map(child => renderFileTree(child, level + 1))}
      </div>
    );
  };

  const CodeEditor = () => (
    <div className="flex h-full">
      {/* File Explorer Sidebar */}
      <div className="w-64 bg-base-100 border-r border-base-300 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
          <span className="text-sm font-semibold uppercase tracking-wide">Explorer</span>
          <div className="flex gap-1">
            <button className="p-1 hover:bg-base-200 rounded">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
            </button>
            <button className="p-1 hover:bg-base-200 rounded">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        <div className="py-2">
          {renderFileTree(fileTree)}
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col bg-base-200">
        {/* Tab Bar */}
        <div className="flex items-center bg-base-100 border-b border-base-300">
          <div className="flex items-center gap-2 px-4 py-2 bg-base-200 border-r border-base-300">
            <span className="text-xs">🔵</span>
            <span className="text-sm">{selectedFile}</span>
            <button className="ml-2 hover:bg-base-300 rounded px-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-auto">
          <div className="p-4 font-mono text-sm">
            {exampleCode.split('\n').map((line, i) => (
              <div key={i} className="flex">
                <span className="text-base-content/40 select-none w-12 text-right pr-4">
                  {i + 1}
                </span>
                <span className="text-base-content">
                  {line.length === 0 ? '\u00A0' : line}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Always use SessionLayout to show status bar
  return (
    <SessionLayout>
      <div className="h-[calc(100vh-112px)]">
        <CodeEditor />
      </div>
    </SessionLayout>
  );
}
