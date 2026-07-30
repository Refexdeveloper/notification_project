import { useState } from 'react';
import { fieldCategories } from '@/mocks/dataforms';

export default function FieldExplorer() {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [draggedField, setDraggedField] = useState<string | null>(null);

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const filteredCategories = fieldCategories.map((cat) => ({
    ...cat,
    fields: cat.fields.filter(
      (f) =>
        !searchTerm.trim() ||
        f.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.name.toLowerCase().includes(searchTerm.toLowerCase()),
    ),
  })).filter((cat) => cat.fields.length > 0);

  const handleDragStart = (fieldId: string) => {
    setDraggedField(fieldId);
  };

  const handleDragEnd = () => {
    setDraggedField(null);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Panel Header */}
      <div className="px-4 py-3 border-b border-background-200/70 shrink-0">
        <h3 className="text-sm font-semibold text-foreground-900">Field Explorer</h3>
        <p className="text-[11px] text-foreground-400 mt-0.5">Drag fields into the editor</p>
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center text-foreground-400">
            <i className="ri-search-line text-xs"></i>
          </span>
          <input
            type="text"
            placeholder="Search fields..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 rounded-md border border-background-200/70 bg-background-50 text-xs text-foreground-900 placeholder:text-foreground-400 outline-none focus:border-primary-300 transition-colors"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {filteredCategories.map((cat) => {
          const isCollapsed = collapsedCategories.has(cat.id);
          return (
            <div key={cat.id} className="mb-1">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(cat.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-background-50 transition-colors cursor-pointer text-left"
              >
                <span className={`w-4 h-4 flex items-center justify-center text-foreground-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                  <i className="ri-arrow-right-s-line text-sm"></i>
                </span>
                <span className="w-3.5 h-3.5 flex items-center justify-center text-foreground-500">
                  <i className={`${cat.icon} text-xs`}></i>
                </span>
                <span className="text-xs font-medium text-foreground-700">{cat.label}</span>
                <span className="text-[10px] text-foreground-400 ml-auto">{cat.fields.length}</span>
              </button>

              {/* Fields */}
              {!isCollapsed && (
                <div className="overflow-hidden">
                  <div className="px-4 pb-1 space-y-0.5">
                    {cat.fields.map((field) => (
                      <div
                        key={field.id}
                        draggable
                        onDragStart={() => handleDragStart(field.id)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-grab active:cursor-grabbing transition-colors group hover:bg-primary-50 ${
                          draggedField === field.id ? 'bg-primary-100 ring-1 ring-primary-300' : ''
                        }`}
                      >
                        <span className="w-3 h-3 flex items-center justify-center text-foreground-400 group-hover:text-primary-500">
                          <i className="ri-draggable text-xs"></i>
                        </span>
                        <span className="text-xs text-foreground-700 group-hover:text-primary-700 flex-1 truncate">
                          {field.label}
                        </span>
                        {field.required && (
                          <span className="text-[10px] text-red-500">*</span>
                        )}
                        <span className="text-[10px] text-foreground-400 bg-background-100 group-hover:bg-primary-100 px-1.5 py-0.5 rounded">
                          {field.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredCategories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
            <span className="text-foreground-300 text-lg mb-2">
              <i className="ri-database-2-line"></i>
            </span>
            <p className="text-xs font-medium text-foreground-600">
              {searchTerm.trim() ? 'No fields match your search' : 'No fields yet'}
            </p>
            <p className="text-[11px] text-foreground-400 mt-1">
              {searchTerm.trim()
                ? 'Try a different search.'
                : 'Sync fields from Kissflow first, then they will appear here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}