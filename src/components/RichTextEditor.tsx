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

const TEXT_COLORS = [
  { name: 'אוטומטי', value: 'foreground', cssVar: true, isAuto: true }, // Auto - adapts to dark/light mode
  { name: 'שחור', value: '#000000', cssVar: false, isAuto: false },
  { name: 'לבן', value: '#FFFFFF', cssVar: false, isAuto: false },
  { name: 'אדום', value: '#EF4444', cssVar: false, isAuto: false },
  { name: 'כתום', value: '#F97316', cssVar: false, isAuto: false },
  { name: 'צהוב', value: '#EAB308', cssVar: false, isAuto: false },
  { name: 'ירוק', value: '#22C55E', cssVar: false, isAuto: false },
  { name: 'כחול', value: '#3B82F6', cssVar: false, isAuto: false },
  { name: 'סגול', value: '#8B5CF6', cssVar: false, isAuto: false },
  { name: 'ורוד', value: '#EC4899', cssVar: false, isAuto: false },
  { name: 'אפור', value: '#6B7280', cssVar: false, isAuto: false },
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
  const { isRTL } = useLanguage();
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

  const handleTextColor = (colorItem: typeof TEXT_COLORS[0]) => {
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
    document.execCommand('insertHTML', false, `<img src="${imageUrl}" alt="תמונה" style="max-width: 100%; height: auto; margin: 0.5rem 0;" />`);
    handleInput();
    setImageUrl('');
    setImageDialogOpen(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'שגיאה', description: 'יש להעלות קובץ תמונה בלבד', variant: 'destructive' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'שגיאה', description: 'גודל הקובץ חייב להיות עד 5MB', variant: 'destructive' });
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
      document.execCommand('insertHTML', false, `<img src="${publicUrl}" alt="תמונה" style="max-width: 100%; height: auto; margin: 0.5rem 0;" />`);
      handleInput();
      setImageDialogOpen(false);
      toast({ title: 'הצלחה', description: 'התמונה הועלתה בהצלחה' });
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({ title: 'שגיאה', description: 'שגיאה בהעלאת התמונה', variant: 'destructive' });
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
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleBold} title="הדגשה">
          <Bold className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleItalic} title="נטוי">
          <Italic className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleUnderline} title="קו תחתון">
          <Underline className="w-3.5 h-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Text color */}
        <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="צבע טקסט">
              <Palette className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="space-y-2">
              <div className="grid grid-cols-6 gap-1">
                {TEXT_COLORS.map((colorItem) => (
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
                    title={colorItem.name}
                  >
                    {colorItem.isAuto && <span className="text-[10px] font-bold text-foreground">א</span>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <input
                  type="color"
                  className="w-6 h-6 rounded border border-border cursor-pointer"
                  onChange={(e) => handleTextColor({ name: 'מותאם אישית', value: e.target.value, cssVar: false, isAuto: false })}
                  title="בחירת צבע מותאם אישית"
                />
                <span className="text-xs text-muted-foreground">מותאם אישית</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Alignment */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleAlignRight} title="יישור לימין">
          <AlignRight className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleAlignCenter} title="יישור למרכז">
          <AlignCenter className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleAlignLeft} title="יישור לשמאל">
          <AlignLeft className="w-3.5 h-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Text Direction */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleDirectionRTL} title="כיוון ימין לשמאל (RTL)">
          <PilcrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleDirectionLTR} title="כיוון שמאל לימין (LTR)">
          <PilcrowLeft className="w-3.5 h-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Lists */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleBulletList} title="רשימה">
          <List className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleNumberedList} title="רשימה ממוספרת">
          <ListOrdered className="w-3.5 h-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Links */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { saveSelection(); setLinkDialogOpen(true); }} title="הוספת קישור">
          <LinkIcon className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleUnlink} title="הסרת קישור">
          <Unlink className="w-3.5 h-3.5" />
        </Button>
        
        <div className="w-px h-5 bg-border mx-1" />
        
        {/* Media */}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { saveSelection(); setImageDialogOpen(true); }} title="הוספת תמונה">
          <Image className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { saveSelection(); setTableDialogOpen(true); }} title="הוספת טבלה">
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
            <DialogTitle>הוספת קישור</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="link-url">כתובת URL</Label>
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
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>ביטול</Button>
            <Button onClick={handleInsertLink} disabled={!linkUrl}>הוספת קישור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>הוספת תמונה</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">העלאה מהמחשב</TabsTrigger>
              <TabsTrigger value="url">כתובת URL</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-4 py-4">
              <div className="flex flex-col items-center justify-center gap-4 p-6 border-2 border-dashed rounded-lg">
                <Upload className="w-10 h-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  לחיצה לבחירת תמונה או גרירה לכאן
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
                  {imageUploading ? 'בהעלאה...' : 'בחירת תמונה'}
                </Button>
                <p className="text-xs text-muted-foreground">עד 5MB</p>
              </div>
            </TabsContent>
            <TabsContent value="url" className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="image-url">כתובת URL של תמונה</Label>
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
                <Button variant="outline" onClick={() => setImageDialogOpen(false)}>ביטול</Button>
                <Button onClick={handleInsertImageUrl} disabled={!imageUrl}>הוספת תמונה</Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Table Dialog */}
      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>הוספת טבלה</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="table-rows">מספר שורות</Label>
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
              <Label htmlFor="table-cols">מספר עמודות</Label>
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
            <Button variant="outline" onClick={() => setTableDialogOpen(false)}>ביטול</Button>
            <Button onClick={handleInsertTable}>הוספת טבלה</Button>
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
