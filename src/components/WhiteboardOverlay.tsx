import { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Pencil, Eraser, Trash2, MousePointer, Hand, 
  Palette, X, Check, Circle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DrawingStroke, CursorPosition } from '@/hooks/useWhiteboard';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface WhiteboardOverlayProps {
  strokes: DrawingStroke[];
  cursors: Map<string, CursorPosition>;
  isDrawingEnabled: boolean;
  isHost: boolean;
  pendingRequests: { userId: string; userName: string }[];
  approvedUsers: Set<string>;
  onAddStroke: (stroke: DrawingStroke) => void;
  onUpdateStroke: (id: string, point: { x: number; y: number }) => void;
  onCursorMove: (x: number, y: number) => void;
  onClearBoard: () => void;
  onRequestAccess: () => void;
  onApproveAccess: (userId: string) => void;
  onRevokeAccess: (userId: string) => void;
  onClose: () => void;
  userId: string;
  userName: string;
}

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', 
  '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff', '#000000'
];

const BRUSH_SIZES = [2, 4, 8, 12];

const WhiteboardOverlay = ({
  strokes,
  cursors,
  isDrawingEnabled,
  isHost,
  pendingRequests,
  approvedUsers,
  onAddStroke,
  onUpdateStroke,
  onCursorMove,
  onClearBoard,
  onRequestAccess,
  onApproveAccess,
  onRevokeAccess,
  onClose,
  userId,
  userName,
}: WhiteboardOverlayProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null);
  const [tool, setTool] = useState<'pointer' | 'pen' | 'eraser'>('pointer');
  const [color, setColor] = useState('#ef4444');
  const [brushSize, setBrushSize] = useState(4);
  const [hasRequestedAccess, setHasRequestedAccess] = useState(false);

  // Draw all strokes to canvas
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Handle eraser strokes
      if (stroke.color === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }
      ctx.lineWidth = stroke.width;
      
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';

    // Draw current stroke if drawing
    if (currentStroke && currentStroke.points.length >= 2) {
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (currentStroke.color === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = currentStroke.color;
      }
      ctx.lineWidth = currentStroke.width;
      
      ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
      for (let i = 1; i < currentStroke.points.length; i++) {
        ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }, [strokes, currentStroke]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redrawCanvas();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [redrawCanvas]);

  // Redraw when strokes change
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (tool === 'pointer') return;
    if (!isDrawingEnabled) return;

    const coords = getCanvasCoords(e);
    const stroke: DrawingStroke = {
      id: `${userId}-${Date.now()}`,
      points: [coords],
      color: tool === 'eraser' ? 'eraser' : color,
      width: tool === 'eraser' ? brushSize * 4 : brushSize,
      userId,
      userName,
    };
    
    setCurrentStroke(stroke);
    setIsDrawing(true);
    onAddStroke(stroke);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getCanvasCoords(e);
    
    // Always broadcast cursor position (normalized 0-1)
    const canvas = canvasRef.current;
    if (canvas) {
      onCursorMove(coords.x / canvas.width, coords.y / canvas.height);
    }

    if (!isDrawing || !currentStroke || tool === 'pointer') return;
    if (!isDrawingEnabled) return;

    const newPoint = coords;
    setCurrentStroke(prev => {
      if (!prev) return null;
      return { ...prev, points: [...prev.points, newPoint] };
    });
    onUpdateStroke(currentStroke.id, newPoint);
  };

  const handlePointerUp = () => {
    if (isDrawing && currentStroke) {
      setIsDrawing(false);
      setCurrentStroke(null);
    }
  };

  const handleRequestAccess = () => {
    setHasRequestedAccess(true);
    onRequestAccess();
  };

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 z-30"
      style={{ touchAction: tool !== 'pointer' ? 'none' : 'auto' }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 w-full h-full",
          tool !== 'pointer' && isDrawingEnabled && "cursor-crosshair"
        )}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />

      {/* Remote cursors */}
      {Array.from(cursors.entries()).map(([peerId, cursor]) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const x = cursor.x * canvas.width;
        const y = cursor.y * canvas.height;
        
        return (
          <div
            key={peerId}
            className="absolute pointer-events-none transition-all duration-75"
            style={{ 
              left: x, 
              top: y,
              transform: 'translate(-2px, -2px)'
            }}
          >
            <MousePointer className="w-5 h-5 text-primary drop-shadow-md" />
            <span className="absolute top-5 left-1 text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded whitespace-nowrap">
              {cursor.userName}
            </span>
          </div>
        );
      })}

      {/* Toolbar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 glass rounded-full px-2 py-1.5 flex items-center gap-1">
        <Button
          variant={tool === 'pointer' ? 'default' : 'ghost'}
          size="icon"
          className="w-8 h-8 rounded-full"
          onClick={() => setTool('pointer')}
          title="מצביע"
        >
          <MousePointer className="w-4 h-4" />
        </Button>

        {isDrawingEnabled && (
          <>
            <Button
              variant={tool === 'pen' ? 'default' : 'ghost'}
              size="icon"
              className="w-8 h-8 rounded-full"
              onClick={() => setTool('pen')}
              title="עט"
            >
              <Pencil className="w-4 h-4" />
            </Button>

            <Button
              variant={tool === 'eraser' ? 'default' : 'ghost'}
              size="icon"
              className="w-8 h-8 rounded-full"
              onClick={() => setTool('eraser')}
              title="מחק"
            >
              <Eraser className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-border mx-1" />

            {/* Color picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-full"
                  title="צבע"
                >
                  <div 
                    className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                    style={{ backgroundColor: color }}
                  />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2">
                <div className="grid grid-cols-5 gap-1">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      className={cn(
                        "w-7 h-7 rounded-full border-2 transition-transform hover:scale-110",
                        c === color ? "border-primary scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Brush size */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-full"
                  title="גודל מברשת"
                >
                  <Circle className="w-4 h-4" style={{ strokeWidth: brushSize / 2 }} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2">
                <div className="flex gap-1">
                  {BRUSH_SIZES.map(size => (
                    <button
                      key={size}
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all",
                        size === brushSize ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary"
                      )}
                      onClick={() => setBrushSize(size)}
                    >
                      <div 
                        className="rounded-full bg-foreground"
                        style={{ width: size + 4, height: size + 4 }}
                      />
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {isHost && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-full text-destructive hover:text-destructive"
                  onClick={onClearBoard}
                  title="נקה לוח"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </>
        )}

        {/* Request access button for non-hosts */}
        {!isDrawingEnabled && !isHost && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={handleRequestAccess}
            disabled={hasRequestedAccess}
          >
            <Hand className="w-4 h-4" />
            {hasRequestedAccess ? 'בקשה נשלחה' : 'בקש לצייר'}
          </Button>
        )}

        <div className="w-px h-6 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 rounded-full"
          onClick={onClose}
          title="סגירת לוח"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Permission requests for host */}
      {isHost && pendingRequests.length > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 glass rounded-xl p-3 space-y-2 max-w-xs">
          <p className="text-xs text-muted-foreground text-center mb-2">בקשות ציור</p>
          {pendingRequests.map(req => (
            <div key={req.userId} className="flex items-center gap-2">
              <span className="text-sm flex-1">{req.userName}</span>
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 text-green-500 hover:text-green-600"
                onClick={() => onApproveAccess(req.userId)}
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 text-destructive"
                onClick={() => onRevokeAccess(req.userId)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Approved users indicator for host */}
      {isHost && approvedUsers.size > 1 && (
        <div className="absolute bottom-3 left-3 glass rounded-lg px-3 py-2">
          <p className="text-xs text-muted-foreground mb-1">מורשים לצייר:</p>
          <div className="flex flex-wrap gap-1">
            {Array.from(approvedUsers).map(uid => (
              <div 
                key={uid} 
                className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1"
              >
                {uid === userId ? 'את/ה' : 'משתתף'}
                {uid !== userId && (
                  <button 
                    onClick={() => onRevokeAccess(uid)}
                    className="hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WhiteboardOverlay;
