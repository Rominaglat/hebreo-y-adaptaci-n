import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Unlink, AlignLeft, AlignCenter, AlignRight, Palette, Image, Table, Upload, PilcrowLeft, PilcrowRight } from 'lucide-react';
import { useRef, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import DOMPurify from 'dompurify';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// Color pairs: light mode color -> dark mode equivalent
const COLOR_PAIRS: Record<string, string> = {
  '#000000': '#FFFFFF', // black <-> white
  '#FFFFFF': '#000000', // white <-> black
  '#1F2937': '#E5E7EB', // dark gray <-> light gray
  '#111827': '#F3F4F6', // darker gray <-> lighter gray
};

const TEXT_COLOR_DEFS = [
  { nameKey: 'richTextEditor.colorAuto', value: 'foreground', cssVar: true, isAuto: true }, // Auto - adapts to dark/light mode
  { nameKey: 'richTextEditor.colorBlack', value: '#000000', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorWhite', value: '#FFFFFF', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorRed', value: '#EF4444', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorOrange', value: '#F97316', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorYellow', value: '#EAB308', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorGreen', value: '#22C55E', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorBlue', value: '#3B82F6', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorPurple', value: '#8B5CF6', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorPink', value: '#EC4899', cssVar: false, isAuto: false },
  { nameKey: 'richTextEditor.colorGray', value: '#6B7280', cssVar: false, isAuto: false },
];

// Get computed CSS variable value
const getCssVarColor = (varName: string): string => {
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);
  const hslValue = computedStyle.getPropertyValue(`--${varName}`).trim();
  if (hslValue) {
    return `hsl(${hslValue})`;
  }
  return varName === 'foreground' ? '#000000' : '#6B7280';
};

// Check if we're in dark mode
const isDarkMode = (): boolean => {
  return document.documentElement.classList.contains('dark');
};

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  className = ''
}: RichTextEditorProps) {
  const { isRTL, t } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInternalChange = useRef(false);
  
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [tableRows, setTableRows] = useState('3');
  const [tableCols, setTableCols] = useState('3');
  const savedSelectionRef = useRef<Range | null>(null);

  // Sync value to editor when changed externally
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      // Sanitize HTML content to prevent XSS attacks
      const sanitizedValue = DOMPurify.sanitize(value || '');
      if (editorRef.current.innerHTML !== sanitizedValue) {
        editorRef.current.innerHTML = sanitizedValue;
      }
    }
    isInternalChange.current = false;
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleBold = () => {
    editorRef.current?.focus();
    document.execCommand('bold', false);
    handleInput();
  };
  
  const handleItalic = () => {
    editorRef.current?.focus();
    document.execCommand('italic', false);
    handleInput();
  };
  
  const handleUnderline = () => {
    editorRef.current?.focus();
    document.execCommand('underline', false);
    handleInput();
  };
  
  const handleBulletList = () => {
    editorRef.current?.focus();
    document.execCommand('insertUnorderedList', false);
    handleInput();
  };
  
  const handleNumberedList = () => {
    editorRef.current?.focus();
    document.execCommand('insertOrderedList', false);
    handleInput();
  };
  
  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (savedSelectionRef.current && editorRef.current) {
      editorRef.current.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(savedSelectionRef.current);
      }
    }
  };

  const handleInsertLink = () => {
    if (!linkUrl) return;
    
    restoreSelection();
    
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().length > 0;
    
    if (!hasSelection) {
      document.execCommand('insertHTML', false, `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkUrl}</a>`);
    } else {
      document.execCommand('createLink', false, linkUrl);
      const links = editorRef.current?.querySelectorAll('a');
      links?.forEach(link => {
        if (!link.hasAttribute('target')) {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        }
      });
    }
    handleInput();
    setLinkUrl('');
    setLinkDialogOpen(false);
  };

  const handleUnlink = () => {
    editorRef.current?.focus();
    document.execCommand('unlink', false);
    handleInput();
  };

  const handleTextColor = (colorItem: typeof TEXT_COLOR_DEFS[0] | { value: string; isAuto: boolean; cssVar: boolean }) => {
    editorRef.current?.focus();
    
    if (colorItem.isAuto) {
      // For "auto" mode, remove the color styling so it inherits from parent
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
          // Get selected content
          const fragment = range.extractContents();
          // Create a span to hold the content and remove font color
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(fragment);
          
          // Remove color from all font tags and spans with color
          tempDiv.querySelectorAll('font[color], span[style*="color"]').forEach(el => {
            const parent = el.parentNode;
            while (el.firstChild) {
              parent?.insertBefore(el.firstChild, el);
            }
            el.remove();
          });
          
          // Also handle inline styles
          tempDiv.querySelectorAll('[style]').forEach(el => {
            const element = el as HTMLElement;
            element.style.color = '';
          });
          
          // Insert all cleaned content back (not just first child)
          const newFragment = document.createDocumentFragment();
          while (tempDiv.firstChild) {
            newFragment.appendChild(tempDiv.firstChild);
          }
          range.insertNode(newFragment);
          handleInput();
        }
      }
    } else {
      document.execCommand('foreColor', false, colorItem.value);
      handleInput();
    }
    setColorPickerOpen(false);
  };

  const handleAlignLeft = () => {
    editorRef.current?.focus();
    document.execCommand('justifyLeft', false);
    handleInput();
  };

  const handleAlignCenter = () => {
    editorRef.current?.focus();
    document.execCommand('justifyCenter', false);
    handleInput();
  };

  const handleAlignRight = () => {
    editorRef.current?.focus();
    document.execCommand('justifyRight', false);
    handleInput();
  };

  const handleDirectionRTL = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const parentBlock = range.commonAncestorContainer.nodeType === Node.TEXT_NODE 
        ? range.commonAncestorContainer.parentElement 
        : range.commonAncestorContainer as HTMLElement;
      
      if (parentBlock && editorRef.current?.contains(parentBlock)) {
        const blockElement = parentBlock.closest('p, div, li, td') as HTMLElement || parentBlock;
        blockElement.setAttribute('dir', 'rtl');
        blockElement.style.textAlign = 'right';
      }
    }
    handleInput();
  };

  const handleDirectionLTR = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const parentBlock = range.commonAncestorContainer.nodeType === Node.TEXT_NODE 
        ? range.commonAncestorContainer.parentElement 
        : range.commonAncestorContainer as HTMLElement;
      
      if (parentBlock && editorRef.current?.contains(parentBlock)) {
        const blockElement = parentBlock.closest('p, div, li, td') as HTMLElement || parentBlock;
        blockElement.setAttribute('dir', 'ltr');
        blockElement.style.textAlign = 'left';
      }
    }
    handleInput();
  };

  const handleInsertImageUrl = () => {
    if (!imageUrl) return;
    
    restoreSelection();
    document.execCommand('insertHTML', false, `<img src="${imageUrl}" alt="${t('richTextEditor.imageAlt')}" style="max-width: 100%; height: auto; margin: 0.5rem 0;" />`);
    handleInput();
    setImageUrl('');
    setImageDialogOpen(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: t('common.error'), description: t('richTextEditor.errorImageOnly'), variant: 'destructive' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: t('common.error'), description: t('richTextEditor.errorFileTooLarge'), variant: 'destructive' });
      return;
    }

    setImageUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `editor-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('course-content')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('course-content')
        .getPublicUrl(filePath);

      restoreSelection();
      document.execCommand('insertHTML', false, `<img src="${publicUrl}" alt="${t('richTextEditor.imageAlt')}" style="max-width: 100%; height: auto; margin: 0.5rem 0;" />`);
      handleInput();
      setImageDialogOpen(false);
      toast({ title: t('common.success'), description: t('richTextEditor.imageUploaded') });
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({ title: t('common.error'), description: t('richTextEditor.imageUploadError'), variant: 'destructive' });
    } finally {
      setImageUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleInsertTable = () => {
    const numRows = parseInt(tableRows, 10);
    const numCols = parseInt(tableCols, 10);
    
    if (numRows > 0 && numCols > 0 && numRows <= 20 && numCols <= 10) {
      let tableHTML = '<table style="width: 100%; border-collapse: collapse; margin: 0.5rem 0;">';
      for (let i = 0; i < numRows; i++) {
        tableHTML += '<tr>';
        for (let j = 0; j < numCols; j++) {
          tableHTML += '<td style="border: 1px solid hsl(var(--border)); padding: 0.5rem; min-width: 50px;">&nbsp;</td>';
        }
        tableHTML += '</tr>';
      }
      tableHTML += '</table>';
      
      restoreSelection();
      document.execCommand('insertHTML', false, tableHTML);
      handleInput();
    }
    setTableRows('3');
    setTableCols('3');
    setTableDialogOpen(false);
  };

  return (
    <div className={`rich-text-editor space-y-2 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-md border flex-wrap">
        {/* Text formatting */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleBold} title={t('richTextEditor.bold')}>
          <Bold className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleItalic} title={t('richTextEditor.italic')}>
          <Italic className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleUnderline} title={t('richTextEditor.underline')}>
          <Underline className="w-3.5 h-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Text color */}
        <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={t('richTextEditor.textColor')}>
              <Palette className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="space-y-2">
              <div className="grid grid-cols-6 gap-1">
                {TEXT_COLOR_DEFS.map((colorItem) => (
                  <button
                    key={colorItem.value}
                    type="button"
                    className={`w-6 h-6 rounded border border-border hover:scale-110 transition-transform flex items-center justify-center ${
                      colorItem.isAuto ? 'bg-gradient-to-br from-foreground/20 to-foreground/80' : ''
                    }`}
                    style={colorItem.isAuto ? undefined : {
                      backgroundColor: colorItem.cssVar
                        ? `hsl(var(--${colorItem.value}))`
                        : colorItem.value
                    }}
                    onClick={() => handleTextColor(colorItem)}
                    title={t(colorItem.nameKey)}
                  >
                    {colorItem.isAuto && <span className="text-[10px] font-bold text-foreground">{t('richTextEditor.autoMarker')}</span>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <input
                  type="color"
                  className="w-6 h-6 rounded border border-border cursor-pointer"
                  onChange={(e) => handleTextColor({ value: e.target.value, cssVar: false, isAuto: false })}
                  title={t('richTextEditor.pickCustomColor')}
                />
                <span className="text-xs text-muted-foreground">{t('richTextEditor.customColor')}</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Alignment */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleAlignRight} title={t('richTextEditor.alignRight')}>
          <AlignRight className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleAlignCenter} title={t('richTextEditor.alignCenter')}>
          <AlignCenter className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleAlignLeft} title={t('richTextEditor.alignLeft')}>
          <AlignLeft className="w-3.5 h-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Text Direction */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleDirectionRTL} title={t('richTextEditor.directionRtl')}>
          <PilcrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleDirectionLTR} title={t('richTextEditor.directionLtr')}>
          <PilcrowLeft className="w-3.5 h-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Lists */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleBulletList} title={t('richTextEditor.bulletList')}>
          <List className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleNumberedList} title={t('richTextEditor.numberedList')}>
          <ListOrdered className="w-3.5 h-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Links */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { saveSelection(); setLinkDialogOpen(true); }} title={t('richTextEditor.insertLink')}>
          <LinkIcon className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleUnlink} title={t('richTextEditor.removeLink')}>
          <Unlink className="w-3.5 h-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Media */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { saveSelection(); setImageDialogOpen(true); }} title={t('richTextEditor.insertImage')}>
          <Image className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { saveSelection(); setTableDialogOpen(true); }} title={t('richTextEditor.insertTable')}>
          <Table className="w-3.5 h-3.5" />
        </Button>
      </div>
      
      {/* WYSIWYG Editor */}
      <div
        ref={editorRef}
        contentEditable
        className="min-h-[120px] p-3 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 overflow-auto prose prose-sm max-w-none"
        dir={isRTL ? 'rtl' : 'ltr'}
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        style={{
          minHeight: '120px',
        }}
      />

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('richTextEditor.insertLink')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="link-url">{t('richTextEditor.urlLabel')}</Label>
              <Input
                id="link-url"
                type="url"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleInsertLink} disabled={!linkUrl}>{t('richTextEditor.insertLink')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('richTextEditor.insertImage')}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">{t('richTextEditor.uploadFromComputer')}</TabsTrigger>
              <TabsTrigger value="url">{t('richTextEditor.urlLabel')}</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-4 py-4">
              <div className="flex flex-col items-center justify-center gap-4 p-6 border-2 border-dashed rounded-lg">
                <Upload className="w-10 h-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  {t('richTextEditor.clickOrDragImage')}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageUploading}
                >
                  {imageUploading ? t('richTextEditor.uploading') : t('richTextEditor.chooseImage')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('richTextEditor.maxFileSize')}</p>
              </div>
            </TabsContent>
            <TabsContent value="url" className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="image-url">{t('richTextEditor.imageUrl')}</Label>
                <Input
                  id="image-url"
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  dir="ltr"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setImageDialogOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleInsertImageUrl} disabled={!imageUrl}>{t('richTextEditor.insertImage')}</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Table Dialog */}
      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t('richTextEditor.insertTable')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="table-rows">{t('richTextEditor.rowsCount')}</Label>
              <Input
                id="table-rows"
                type="number"
                min="1"
                max="20"
                value={tableRows}
                onChange={(e) => setTableRows(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-cols">{t('richTextEditor.colsCount')}</Label>
              <Input
                id="table-cols"
                type="number"
                min="1"
                max="10"
                value={tableCols}
                onChange={(e) => setTableCols(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTableDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleInsertTable}>{t('richTextEditor.insertTable')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
        }
        [contenteditable] table {
          width: 100%;
          border-collapse: collapse;
        }
        [contenteditable] td {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem;
          min-width: 50px;
        }
      `}</style>
    </div>
  );
}
