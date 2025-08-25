/**
 * [NexusDev] - NexusConverter Microservice v2.4.0
 *
 * Mission: Provide a multi-format, high-performance API for converting local files and YouTube videos.
 * v2.4.0 Update: Integrated watermarking functionality into the /convert/image endpoint.
 * The endpoint now accepts an optional 'watermark' file to overlay on the base image.
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
// NexusDev: Inicia la actualización del endpoint de imagen v2.4.0
// =================================================================
app.post('/convert/image', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'watermark', maxCount: 1 }]), async (req, res) => {
    try {
        const imageFile = req.files.image ? req.files.image[0] : null;
        const watermarkFile = req.files.watermark ? req.files.watermark[0] : null;

        if (!imageFile) {
            return res.status(400).json({ success: false, error: 'Campo "image" requerido.' });
        }

        const targetFormat = req.body.format || 'jpeg';
        const quality = parseInt(req.body.quality, 10) || 90;

        let imageProcessor = sharp(imageFile.buffer);
        
        // --- Lógica de Marca de Agua ---
        if (watermarkFile) {
            console.log('[NexusConverter] Aplicando marca de agua...');
            
            const baseImageMetadata = await imageProcessor.metadata();
            
            // 1. Redimensionar marca de agua al 30% del ancho de la imagen base
            const watermarkResizedBuffer = await sharp(watermarkFile.buffer)
                .resize({ 
                    width: Math.round(baseImageMetadata.width * 0.30) 
                })
                .toBuffer();

            // 2. Calcular posición (esquina inferior derecha con margen del 2%)
            const watermarkMetadata = await sharp(watermarkResizedBuffer).metadata();
            const margin = Math.round(baseImageMetadata.width * 0.02);
            const top = baseImageMetadata.height - watermarkMetadata.height - margin;
            const left = baseImageMetadata.width - watermarkMetadata.width - margin;
            
            // 3. Superponer la imagen usando composite
            imageProcessor.composite([{
                input: watermarkResizedBuffer,
                top: top,
                left: left,
            }]);
            console.log('[NexusConverter] Marca de agua compuesta exitosamente.');
        }
        
        // --- Conversión de Formato y Salida ---
        let outputImage;
        switch (targetFormat.toLowerCase()) {
            case 'jpeg':
            case 'jpg':
                outputImage = await imageProcessor.jpeg({ quality }).toBuffer();
                res.setHeader('Content-Type', 'image/jpeg');
                break;
            case 'png':
                outputImage = await imageProcessor.png().toBuffer();
                res.setHeader('Content-Type', 'image/png');
                break;
            case 'webp':
                outputImage = await imageProcessor.webp({ quality }).toBuffer();
                res.setHeader('Content-Type', 'image/webp');
                break;
            default:
                return res.status(400).json({ success: false, error: `Formato no soportado: ${targetFormat}` });
        }

        console.log(`[NexusConverter] Imagen convertida a ${targetFormat} con calidad ${quality}.`);
        res.send(outputImage);

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
        
        // Comando yt-dlp optimizado para obtener la mejor calidad de video y audio combinados en un mp4.
        // -f 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]': Selecciona el mejor video con extensión mp4 y el mejor audio con m4a, y los une.
        // --merge-output-format mp4: Asegura que el contenedor final sea mp4, incluso si los streams originales no lo son.
        // --output: Especifica la ruta de salida.
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
    res.status(200).json({ status: 'ok', version: '2.4.0', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`[NexusConverter] Microservice v2.4.0 escuchando en el puerto ${PORT}`);
    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR);
    }
});
