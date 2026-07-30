import { useState, useRef, useCallback } from 'react';
import { notificationVariables } from '@/mocks/dataforms';

const blockTypes = [
  { id: 'header', label: 'Header', icon: 'ri-heading' },
  { id: 'paragraph', label: 'Paragraph', icon: 'ri-text' },
  { id: 'image', label: 'Image', icon: 'ri-image-line' },
  { id: 'button', label: 'Button', icon: 'ri-cursor-line' },
  { id: 'divider', label: 'Divider', icon: 'ri-separator' },
  { id: 'table', label: 'Table', icon: 'ri-table-line' },
  { id: 'signature', label: 'Signature', icon: 'ri-pen-nib-line' },
  { id: 'footer', label: 'Footer', icon: 'ri-layout-bottom-line' },
  { id: 'spacer', label: 'Spacer', icon: 'ri-arrow-up-down-line' },
  { id: 'html', label: 'Raw HTML', icon: 'ri-code-line' },
];

const fontSizes = ['8px', '10px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'];
const fontFamilies = ['Inter', 'Georgia', 'Courier New', 'Arial', 'Times New Roman'];

export default function NotificationBuilder() {
  const [templateName, setTemplateName] = useState('New Notification Template');
  const [subject, setSubject] = useState('{{Employee Name}} - Onboarding Notification');
  const [recipients, setRecipients] = useState<string[]>(['{{Reporting Manager}}', '{{HR Business Partner}}']);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [bccRecipients, setBccRecipients] = useState<string[]>([]);
  const [showVariables, setShowVariables] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [editorContent, setEditorContent] = useState(
    '<h2>Welcome to the Team, {{Employee Name}}!</h2><p>We are excited to have you join <strong>{{Department}}</strong> as our new {{Job Title}}.</p><p>Your start date is <strong>{{Start Date}}</strong> and your reporting manager will be <strong>{{Reporting Manager}}</strong>.</p><p>Please review the attached documents and complete your onboarding tasks before your first day.</p><div style="margin: 20px 0; border-top: 1px solid #E5E7EB;"></div><p style="color: #6B7280; font-size: 12px;">This is an automated notification from the Employee Onboarding system. Please do not reply to this email.</p>',
  );

  const [recipientInput, setRecipientInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [activeRecipientTab, setActiveRecipientTab] = useState<'to' | 'cc' | 'bcc'>('to');

  const editorRef = useRef<HTMLDivElement>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [showEditorToolbar, setShowEditorToolbar] = useState(true);

  const addRecipient = (type: 'to' | 'cc' | 'bcc') => {
    const inputVal = type === 'to' ? recipientInput : type === 'cc' ? ccInput : bccInput;
    const setter = type === 'to' ? setRecipients : type === 'cc' ? setCcRecipients : setBccRecipients;
    const inputSetter = type === 'to' ? setRecipientInput : type === 'cc' ? setCcInput : setBccInput;
    if (inputVal.trim()) {
      setter((prev) => [...prev, inputVal.trim()]);
      inputSetter('');
    }
  };

  const removeRecipient = (type: 'to' | 'cc' | 'bcc', index: number) => {
    const setter = type === 'to' ? setRecipients : type === 'cc' ? setCcRecipients : setBccRecipients;
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  const insertVariable = (variable: string) => {
    if (editorRef.current) {
      const textNode = document.createTextNode(variable);
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(textNode);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      editorRef.current.focus();
    }
    setShowVariables(false);
  };

  const execCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent, type: 'to' | 'cc' | 'bcc') => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addRecipient(type);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Panel Header */}
      <div className="px-5 py-4 border-b border-background-200/70 shrink-0">
        <h3 className="text-sm font-semibold text-foreground-900">Notification Builder</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Template Name */}
        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">Template Name</label>
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-background-300/60 bg-white text-sm text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-all"
          />
        </div>

        {/* Subject */}
        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">Email Subject</label>
          <div className="relative">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-background-300/60 bg-white text-sm text-foreground-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-all pr-10"
            />
            <button
              onClick={() => setShowVariables(true)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md hover:bg-primary-50 text-primary-500 transition-colors cursor-pointer"
              title="Insert Variable"
            >
              <span className="w-4 h-4 flex items-center justify-center">
                <i className="ri-braces-line text-sm"></i>
              </span>
            </button>
          </div>
        </div>

        {/* Recipients */}
        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">Recipients</label>
          <div className="flex items-center gap-1 mb-2 bg-background-100 rounded-lg p-1 w-fit">
            {(['to', 'cc', 'bcc'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveRecipientTab(tab)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  activeRecipientTab === tab
                    ? 'bg-white text-foreground-900 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700'
                }`}
              >
                {tab === 'to' ? 'To' : tab === 'cc' ? 'CC' : 'BCC'}
              </button>
            ))}
          </div>
          <div className="border border-background-300/60 rounded-lg p-2 min-h-[42px] flex flex-wrap gap-1.5 items-center">
            {(activeRecipientTab === 'to' ? recipients : activeRecipientTab === 'cc' ? ccRecipients : bccRecipients).map(
              (r, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 text-xs font-medium"
                >
                  {r.startsWith('{{') ? (
                    <span className="w-3 h-3 flex items-center justify-center text-primary-400">
                      <i className="ri-braces-line text-[10px]"></i>
                    </span>
                  ) : null}
                  {r}
                  <button
                    onClick={() => removeRecipient(activeRecipientTab, i)}
                    className="w-3.5 h-3.5 flex items-center justify-center hover:text-primary-900 cursor-pointer"
                  >
                    <i className="ri-close-line text-xs"></i>
                  </button>
                </span>
              ),
            )}
            <input
              type="text"
              value={activeRecipientTab === 'to' ? recipientInput : activeRecipientTab === 'cc' ? ccInput : bccInput}
              onChange={(e) => {
                if (activeRecipientTab === 'to') setRecipientInput(e.target.value);
                else if (activeRecipientTab === 'cc') setCcInput(e.target.value);
                else setBccInput(e.target.value);
              }}
              onKeyDown={(e) => handleKeyDown(e, activeRecipientTab)}
              placeholder="Type email or select variable..."
              className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-xs text-foreground-900 placeholder:text-foreground-400"
            />
          </div>
        </div>

        {/* Variables Drawer Toggle */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowVariables(!showVariables)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap"
          >
            <span className="w-3.5 h-3.5 flex items-center justify-center">
              <i className="ri-braces-line"></i>
            </span>
            {showVariables ? 'Hide Variables' : 'Insert Variables'}
          </button>
        </div>

        {/* Variables Drawer */}
        {showVariables && (
          <div className="border border-background-300/60 rounded-lg p-3 bg-background-50">
            <div className="grid grid-cols-3 gap-1.5">
              {notificationVariables.map((v) => {
                const colorStyles: Record<string, string> = {
                  primary: 'hover:bg-primary-50 hover:text-primary-700',
                  accent: 'hover:bg-accent-50 hover:text-accent-700',
                  secondary: 'hover:bg-secondary-50 hover:text-secondary-700',
                };
                return (
                  <button
                    key={v.id}
                    onClick={() => insertVariable(v.variable)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${colorStyles[v.color] || ''}`}
                  >
                    <span className="w-3 h-3 flex items-center justify-center">
                      <i className={`${v.icon} text-[10px]`}></i>
                    </span>
                    {v.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Rich Text Editor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-foreground-600">Email Body</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowEditorToolbar(!showEditorToolbar)}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-background-100 text-foreground-500 cursor-pointer"
                title="Toggle Toolbar"
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  <i className={`${showEditorToolbar ? 'ri-layout-top-2-line' : 'ri-layout-top-line'} text-sm`}></i>
                </span>
              </button>
              <button
                onClick={() => setSourceMode(!sourceMode)}
                className={`w-7 h-7 flex items-center justify-center rounded-md cursor-pointer ${
                  sourceMode
                    ? 'bg-primary-50 text-primary-600'
                    : 'hover:bg-background-100 text-foreground-500'
                }`}
                title="Toggle HTML Source"
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  <i className="ri-code-line text-sm"></i>
                </span>
              </button>
            </div>
          </div>

          {/* Formatting Toolbar */}
          {showEditorToolbar && !sourceMode && (
            <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border border-background-300/60 rounded-t-lg bg-background-50">
              {/* Text formatting */}
              <button onClick={() => execCommand('bold')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Bold">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-bold text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('italic')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Italic">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-italic text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('underline')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Underline">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-underline text-sm"></i></span>
              </button>
              <span className="w-px h-4 bg-background-300 mx-0.5"></span>
              {/* Alignment */}
              <button onClick={() => execCommand('justifyLeft')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Align Left">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-align-left text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('justifyCenter')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Align Center">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-align-center text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('justifyRight')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Align Right">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-align-right text-sm"></i></span>
              </button>
              <span className="w-px h-4 bg-background-300 mx-0.5"></span>
              {/* Lists */}
              <button onClick={() => execCommand('insertUnorderedList')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Bullet List">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-list-unordered text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('insertOrderedList')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Numbered List">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-list-ordered text-sm"></i></span>
              </button>
              <span className="w-px h-4 bg-background-300 mx-0.5"></span>
              {/* Insert */}
              <button onClick={() => execCommand('createLink', 'https://')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Insert Link">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-link text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('insertHTML', '<img src="" alt="" style="max-width:100%"/>')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Insert Image">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-image-add-line text-sm"></i></span>
              </button>
              <button onClick={() => execCommand('insertHorizontalRule')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-600 cursor-pointer" title="Insert Divider">
                <span className="w-4 h-4 flex items-center justify-center"><i className="ri-separator text-sm"></i></span>
              </button>
              <span className="w-px h-4 bg-background-300 mx-0.5"></span>
              {/* Variable */}
              <button
                onClick={() => setShowVariables(!showVariables)}
                className="inline-flex items-center gap-1 px-2 h-7 rounded hover:bg-primary-50 text-primary-600 cursor-pointer text-xs font-medium"
                title="Insert Variable"
              >
                <span className="w-3.5 h-3.5 flex items-center justify-center"><i className="ri-braces-line"></i></span>
                Variable
              </button>
              {/* Font size */}
              <span className="w-px h-4 bg-background-300 mx-0.5"></span>
              <select
                onChange={(e) => execCommand('fontSize', e.target.value)}
                className="h-7 px-1.5 text-xs rounded border-none bg-transparent text-foreground-600 cursor-pointer outline-none"
                defaultValue="3"
              >
                {fontSizes.map((s, i) => (
                  <option key={s} value={`${i + 1}`}>{s}</option>
                ))}
              </select>
              <select
                onChange={(e) => execCommand('fontName', e.target.value)}
                className="h-7 px-1.5 text-xs rounded border-none bg-transparent text-foreground-600 cursor-pointer outline-none"
              >
                {fontFamilies.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          )}

          {/* Editor Area */}
          <div className={`border border-background-300/60 bg-white min-h-[320px] ${showEditorToolbar && !sourceMode ? 'border-t-0 rounded-b-lg' : 'rounded-lg'}`}>
            {sourceMode ? (
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                className="w-full h-full min-h-[320px] p-4 text-sm font-mono text-foreground-900 outline-none resize-none rounded-lg"
                spellCheck={false}
              />
            ) : (
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="w-full min-h-[320px] p-4 text-sm text-foreground-900 outline-none rounded-b-lg prose prose-sm max-w-none [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_p]:mb-2 [&_p]:leading-relaxed [&_strong]:text-foreground-900"
                dangerouslySetInnerHTML={{ __html: editorContent }}
                onInput={(e) => {
                  setEditorContent(e.currentTarget.innerHTML);
                }}
              />
            )}
          </div>
        </div>

        {/* Block Types */}
        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-2">Quick Blocks</label>
          <div className="flex items-center flex-wrap gap-1.5">
            {blockTypes.map((block) => (
              <button
                key={block.id}
                onClick={() => setSelectedBlock(block.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  selectedBlock === block.id
                    ? 'bg-primary-50 text-primary-700 border border-primary-200'
                    : 'bg-background-50 text-foreground-600 hover:bg-background-100 border border-transparent'
                }`}
              >
                <span className="w-3 h-3 flex items-center justify-center">
                  <i className={`${block.icon} text-[10px]`}></i>
                </span>
                {block.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}