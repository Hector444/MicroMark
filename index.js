// =================================================================
// NexusDev: Endpoint de imagen v4.1.0 (marca de agua diagonal grande)
// =================================================================
app.post(
  '/convert/image',
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'watermark', maxCount: 1 }]),
  async (req, res) => {
    try {
      const imageFile = req.files?.image?.[0];
      const logoFile  = req.files?.watermark?.[0];
      if (!imageFile || !logoFile) {
        return res.status(400).json({ success: false, error: 'Se requieren "image" y "watermark".' });
      }

      // ---- Parámetros opcionales ----
      const targetFormat      = (req.body.format || 'jpeg').toLowerCase();    // 'jpeg' | 'png'
      const quality           = parseInt(req.body.quality, 10) || 90;
      const layout            = (req.body.layout || 'sheet').toLowerCase();   // 'sheet' | 'overlay'
      const watermarkMode     = (req.body.watermarkMode || 'diagonal').toLowerCase(); // 'diagonal' | 'center'
      const watermarkOpacity  = Math.max(0, Math.min(1, parseFloat(req.body.watermarkOpacity ?? '0.30'))); // 0..1
      const watermarkScale    = Math.max(0.1, parseFloat(req.body.watermarkScale ?? '2.5')); // relativo al ancho
      const watermarkAngle    = parseFloat(req.body.watermarkAngle ?? '45');  // grados

      // ---- Dimensiones base ----
      const canvasWidth  = layout === 'sheet' ? 800 : 1200;   // para overlay damos más resolución
      const canvasHeight = layout === 'sheet' ? 1000 : 1200;
      const mainImageHeight = layout === 'sheet' ? 800 : canvasHeight; // en overlay ocupa todo

      // ---- 1) Fondo blanco (con alfa) ----
      const base = sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      });

      // ---- 2) Logo de marca de agua preparado (gigante + diagonal opcional) ----
      // Escalamos el ancho del logo respecto al ancho del lienzo
      let logoPre = sharp(logoFile.buffer)
        .resize({ width: Math.round(canvasWidth * watermarkScale) }, { fit: 'inside' });

      if (watermarkMode === 'diagonal') {
        // Rotamos con fondo transparente
        logoPre = logoPre.rotate(watermarkAngle, { background: { r: 255, g: 255, b: 255, alpha: 0 } });
      }

      // Forzamos PNG para preservar alfa en composite
      const logoPrepared = await logoPre.png().toBuffer();
      const logoMeta = await sharp(logoPrepared).metadata();

      // Centro del lienzo
      const wmLeft = Math.round((canvasWidth  - (logoMeta.width  ?? canvasWidth))  / 2);
      const wmTop  = Math.round((canvasHeight - (logoMeta.height ?? canvasHeight)) / 2);

      // ---- 3) Imagen del producto ----
      // En 'sheet' la imagen va 800x800 arriba. En 'overlay' ocupa todo el lienzo.
      const productImageBuffer = await sharp(imageFile.buffer)
        .resize(
          canvasWidth,
          mainImageHeight,
          { fit: 'cover', position: 'attention' }
        )
        .png()
        .toBuffer();

      // ---- 4) (Opcional) Logo “normal” abajo en modo sheet ----
      let bottomLogoComp = [];
      if (layout === 'sheet') {
        const bottomLogoBuf = await sharp(logoFile.buffer).resize({ width: 400 }).png().toBuffer();
        const bottomMeta = await sharp(bottomLogoBuf).metadata();
        const bottomLeft = Math.round((canvasWidth - (bottomMeta.width ?? 400)) / 2);
        const bottomTop  = 800 + Math.round(((canvasHeight - 800) - (bottomMeta.height ?? 0)) / 2);

        bottomLogoComp.push({ input: bottomLogoBuf, left: bottomLeft, top: bottomTop });
      }

      // ---- 5) Composición (marca de agua detrás del producto) ----
      // Primero el watermark con opacidad, luego el producto por encima.
      const composed = await base
        .composite([
          { input: logoPrepared, left: wmLeft, top: wmTop, opacity: watermarkOpacity },
          { input: productImageBuffer, left: 0, top: 0 },
          ...bottomLogoComp
        ])
        .toFormat(targetFormat === 'png' ? 'png' : 'jpeg', { quality })
        .toBuffer();

      res.setHeader('Content-Type', `image/${targetFormat === 'png' ? 'png' : 'jpeg'}`);
      res.send(composed);
    } catch (error) {
      console.error('[NexusConverter] Error en /convert/image:', error);
      res.status(500).json({ success: false, error: 'Error procesando la imagen.', details: error.message });
    }
  }
);
// =================================================================
// Fin v4.1.0
// =================================================================
