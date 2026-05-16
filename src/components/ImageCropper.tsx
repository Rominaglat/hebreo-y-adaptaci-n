import { useState, useRef, useCallback } from 'react';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Loader2, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';

interface ImageCropperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The original image (data URL or blob URL) loaded by the parent */
  imageSrc: string | null;
  /** Aspect ratio for the crop area. Default 1 (square) */
  aspect?: number;
  /** Output width (the crop will be resized to this) */
  outputSize?: number;
  /** Called when the user confirms the crop. Receives a Blob (PNG). */
  onCropComplete: (blob: Blob) => Promise<void> | void;
  isUploading?: boolean;
}

function centerInitialCrop(width: number, height: number, aspect: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height),
    width,
    height
  );
}

async function cropToBlob(
  imageEl: HTMLImageElement,
  pixelCrop: PixelCrop,
  outputSize: number
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unsupported');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ReactCrop uses the rendered image dimensions, not natural dimensions.
  const scaleX = imageEl.naturalWidth / imageEl.width;
  const scaleY = imageEl.naturalHeight / imageEl.height;

  ctx.drawImage(
    imageEl,
    pixelCrop.x * scaleX,
    pixelCrop.y * scaleY,
    pixelCrop.width * scaleX,
    pixelCrop.height * scaleY,
    0,
    0,
    outputSize,
    outputSize
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas_to_blob_failed'))),
      'image/png',
      0.92
    );
  });
}

export function ImageCropper({
  open,
  onOpenChange,
  imageSrc,
  aspect = 1,
  outputSize = 512,
  onCropComplete,
  isUploading = false,
}: ImageCropperProps) {
  const { language } = useLanguage();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [scale, setScale] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { width, height } = e.currentTarget;
      setCrop(centerInitialCrop(width, height, aspect));
    },
    [aspect]
  );

  const handleConfirm = async () => {
    if (!imgRef.current || !completedCrop?.width || !completedCrop?.height) return;
    setIsProcessing(true);
    try {
      const blob = await cropToBlob(imgRef.current, completedCrop, outputSize);
      await onCropComplete(blob);
      // Reset state for next time
      setCrop(undefined);
      setCompletedCrop(undefined);
      setScale(1);
    } catch (e) {
      console.error('Crop failed', e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (isUploading || isProcessing) return;
    setCrop(undefined);
    setCompletedCrop(undefined);
    setScale(1);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden border-border/60">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>{language === 'he' ? 'חיתוך תמונה' : 'Crop image'}</DialogTitle>
          <DialogDescription>
            {language === 'he'
              ? 'יש לגרור את הריבוע כדי לבחור את האזור הרצוי'
              : 'Drag the box to select the desired area'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-3 space-y-4">
          {imageSrc ? (
            <div className="flex items-center justify-center bg-muted/30 rounded-lg p-4 min-h-[280px]" dir="ltr">
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                onComplete={(c) => setCompletedCrop(c)}
                aspect={aspect}
                circularCrop={aspect === 1}
                className="max-h-[420px]"
              >
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="To crop"
                  onLoad={onImageLoad}
                  style={{ transform: `scale(${scale})`, maxHeight: 420 }}
                  className="block"
                />
              </ReactCrop>
            </div>
          ) : (
            <div className="flex items-center justify-center bg-muted/30 rounded-lg min-h-[280px] text-muted-foreground">
              <Upload className="w-8 h-8" />
            </div>
          )}

          {/* Zoom slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                {language === 'he' ? 'זום' : 'Zoom'}
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
            </div>
            <Slider
              value={[scale]}
              min={0.5}
              max={3}
              step={0.05}
              onValueChange={(v) => setScale(v[0])}
              dir="ltr"
            />
          </div>
        </div>

        <DialogFooter className="p-5 pt-3 border-t border-border/50 bg-muted/20">
          <Button variant="outline" onClick={handleClose} disabled={isUploading || isProcessing}>
            <X className="w-4 h-4 me-1.5" />
            {language === 'he' ? 'ביטול' : 'Cancel'}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!completedCrop?.width || isUploading || isProcessing}
            className="gap-1.5 bg-gradient-to-br from-primary to-accent shadow-md shadow-primary/20"
          >
            {(isUploading || isProcessing) && <Loader2 className="w-4 h-4 animate-spin" />}
            {language === 'he' ? 'שמירת תמונה' : 'Save image'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
