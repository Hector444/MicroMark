/**
 * [NexusDev] - NexusConverter Microservice v4.0.0
 *
 * Mission: Provide a multi-format, high-performance API for converting local files and YouTube videos.
 * v4.0.0 Update: Rebuilt the image logic to create a "product sheet" composition.
 * - Creates a vertical 800x1000 white canvas.
 * - Places the main product image (800x800) at the top.
 * - Places the logo, resized, in the bottom section.
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const libre = require('libreoffice-convert');
const util = require('util');

libre.convertAsync = util.promisify(libre.convert);

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});
const TMP_DIR = '/tmp';

// --- Middleware ---
app.use(express.json());
app.use((req, res, next) => {
    console.log(`[NexusConverter] Request received: ${req.method} ${req.path}`);
    next();
});

// --- API Endpoints ---

// =================================================================
// NexusDev: Inicia la actualización del endpoint de imagen v4.0.0
// =================================================================
app.post('/convert/image', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'watermark', maxCount: 1 }]), async (req, res) => {
    try {
        const imageFile = req.files.image ? req.files.image[0] : null;
        // El "watermark" ahora lo trataremos como el "logo"
        const logoFile = req.files.watermark ? req.files.watermark[0] : null;

        if (!imageFile || !logoFile) {
            return res.status(400).json({ success: false, error: 'Se requieren los campos "image" y "watermark" (logo).' });
        }

        const targetFormat = req.body.format || 'jpeg';
        const quality = parseInt(req.body.quality, 10) || 90;

        console.log('[NexusConverter] Creando ficha de producto (v4.0.0)...');

        // 1. Preparar la imagen del producto (capa superior)
        const productImageBuffer = await sharp(imageFile.buffer)
            .resize(800, 800, { fit: 'cover', position: 'attention' })
            .toBuffer();

        // 2. Preparar el logo (capa inferior)
        const logoImageBuffer = await sharp(logoFile.buffer)
            .resize({ width: 400 }) // Redimensionar el logo a un ancho de 400px
            .toBuffer();

        const logoMetadata = await sharp(logoImageBuffer).metadata();
        
        // 3. Calcular la posición del logo para centrarlo en el área inferior
        const canvasWidth = 800;
        const canvasHeight = 1000;
        const mainImageHeight = 800;

        const logoTopPosition = mainImageHeight + Math.round(((canvasHeight - mainImageHeight) - logoMetadata.height) / 2);
        const logoLeftPosition = Math.round((canvasWidth - logoMetadata.width) / 2);

        // 4. Crear lienzo y componer la imagen final
        const finalImage = await sharp({
            create: {
                width: canvasWidth,
                height: canvasHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 } // Fondo blanco
            }
        })
        .composite([
            { input: productImageBuffer, top: 0, left: 0 },
            { input: logoImageBuffer, top: logoTopPosition, left: logoLeftPosition }
        ])
        .toFormat(targetFormat.toLowerCase() === 'png' ? 'png' : 'jpeg', { quality })
        .toBuffer();

        console.log('[NexusConverter] Ficha de producto creada exitosamente.');

        res.setHeader('Content-Type', `image/${targetFormat.toLowerCase()}`);
        res.send(finalImage);

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/image:', error);
        res.status(500).json({ success: false, error: 'Error procesando la imagen.', details: error.message });
    }
});
// =================================================================
// NexusDev: Finaliza la actualización del endpoint de imagen
// =================================================================


app.post('/convert/video', upload.single('video'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Campo "video" requerido.' });
        
        const format = req.body.format || 'mp4';
        const inputPath = path.join(TMP_DIR, `input_${Date.now()}`);
        const outputPath = `${inputPath}.${format}`;

        fs.writeFileSync(inputPath, req.file.buffer);

        ffmpeg(inputPath)
            .toFormat(format)
            .on('end', () => {
                console.log('[NexusConverter] Conversión de video finalizada.');
                res.setHeader('Content-Type', `video/${format}`);
                res.sendFile(outputPath, (err) => {
                    fs.unlink(inputPath, () => {});
                    fs.unlink(outputPath, () => {});
                    if (err) console.error("Error al enviar archivo de video:", err);
                });
            })
            .on('error', (err) => {
                console.error('[NexusConverter] Error en ffmpeg:', err);
                fs.unlink(inputPath, () => {});
                res.status(500).json({ success: false, error: 'Fallo al convertir el video.', details: err.message });
            })
            .save(outputPath);

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/video:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
    }
});


app.post('/convert/document', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Campo \"document\" requerido.' });

        const format = req.body.format || 'pdf';
        const inputPath = path.join(TMP_DIR, req.file.originalname);
        const outputPath = path.join(TMP_DIR, `${path.parse(req.file.originalname).name}.${format}`);

        fs.writeFileSync(inputPath, req.file.buffer);

        console.log(`[NexusConverter] Intentando convertir ${inputPath} a ${format}`);

        const pdfBuffer = await libre.convertAsync(req.file.buffer, `.${format}`, undefined);
        
        fs.writeFileSync(outputPath, pdfBuffer);
        
        console.log(`[NexusConverter] Documento convertido a ${format}`);
        res.setHeader('Content-Type', 'application/pdf'); // Siempre devolvemos PDF
        res.sendFile(outputPath, (err) => {
            fs.unlink(inputPath, () => {});
            fs.unlink(outputPath, () => {});
            if (err) console.error("Error al enviar archivo de documento:", err);
        });

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/document:', error);
        res.status(500).json({ success: false, error: 'Fallo al convertir el documento.', details: error.message });
    }
});


app.get('/convert/youtube', async (req, res) => {
    try {
        const { url: youtubeUrl, format = 'mp4' } = req.query;
        if (!youtubeUrl) return res.status(400).json({ success: false, error: 'Parámetro \"url\" de YouTube es requerido.' });

        const outputPath = path.join(TMP_DIR, `youtube_video_${Date.now()}.${format}`);
        
        const command = `yt-dlp -f 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]' --merge-output-format mp4 \"${youtubeUrl}\" -o \"${outputPath}\"`;
        
        console.log(`[NexusConverter] Ejecutando comando yt-dlp: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`[NexusConverter] Error en 'yt-dlp': ${stderr}`);
                return res.status(500).json({ success: false, error: 'Fallo al descargar o procesar el video de YouTube.', details: stderr });
            }
            
            console.log('[NexusConverter] Descarga de YouTube completada.');
            res.setHeader('Content-Type', `video/${format}`);
            res.sendFile(outputPath, (err) => {
                fs.unlink(outputPath, () => {}); // Cleanup
                if (err) console.error("Error al enviar archivo de YouTube:", err);
            });
        });

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/youtube:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
    }
});


// --- Health Check & Server Init ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', version: '4.0.0', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`[NexusConverter] Microservice v4.0.0 escuchando en el puerto ${PORT}`);
    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR);
    }
});
