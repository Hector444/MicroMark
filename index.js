/**
 * [NexusDev] - NexusConverter Microservice v2.2.1
 *
 * Mission: Provide a multi-format, high-performance API for converting local files and YouTube videos.
 * v2.2.1 Update: Added robust error handling and better format selection for the YouTube download stream to prevent empty file errors.
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ytdl = require('ytdl-core');

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

// (Las rutas /convert/image, /convert/video, /convert/document permanecen sin cambios)
app.post('/convert/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Campo "image" requerido.' });
        const targetFormat = req.body.format || 'webp';
        const quality = parseInt(req.body.quality, 10) || 80;
        const supportedFormats = ['jpeg', 'png', 'webp', 'tiff', 'avif'];
        if (!supportedFormats.includes(targetFormat)) return res.status(400).json({ success: false, error: `Formato de imagen no soportado: '${targetFormat}'.` });
        if (isNaN(quality) || quality < 1 || quality > 100) return res.status(400).json({ success: false, error: 'La calidad debe ser un número entre 1 y 100.' });

        console.log(`[NexusConverter] Procesando imagen a formato: ${targetFormat}, calidad: ${quality}`);
        const outputBuffer = await sharp(req.file.buffer).toFormat(targetFormat, { quality }).toBuffer();
        res.setHeader('Content-Type', `image/${targetFormat}`);
        res.status(200).send(outputBuffer);
    } catch (error) {
        console.error('[NexusConverter] Error en /convert/image:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
    }
});
app.post('/convert/video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "video" requerido.' });
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const inputPath = path.join(TMP_DIR, `${uniqueSuffix}-${req.file.originalname}`);
    fs.writeFileSync(inputPath, req.file.buffer);

    const targetFormat = req.body.format || 'mp4';
    const videoBitrate = req.body.videoBitrate || '1000k';
    const audioBitrate = req.body.audioBitrate || '128k';
    const outputPath = path.join(TMP_DIR, `output-${uniqueSuffix}.${targetFormat}`);

    console.log(`[NexusConverter] Procesando video a ${targetFormat}, V-Bitrate: ${videoBitrate}, A-Bitrate: ${audioBitrate}`);
    ffmpeg(inputPath)
        .videoBitrate(videoBitrate).audioBitrate(audioBitrate).toFormat(targetFormat)
        .on('error', (err) => {
            console.error('[NexusConverter] Error en FFMPEG:', err);
            fs.unlink(inputPath, () => {});
            res.status(500).json({ success: false, error: 'Fallo en la conversión de video.', details: err.message });
        })
        .on('end', () => {
            res.setHeader('Content-Type', `video/${targetFormat}`);
            res.sendFile(outputPath, (err) => {
                fs.unlink(inputPath, () => {});
                fs.unlink(outputPath, () => {});
                if (err) console.error("Error al enviar archivo de video:", err);
            });
        })
        .save(outputPath);
});
app.post('/convert/document', upload.single('document'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "document" requerido.' });
    const targetFormat = req.body.format || 'pdf';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const inputPath = path.join(TMP_DIR, `${uniqueSuffix}-${req.file.originalname}`);
    fs.writeFileSync(inputPath, req.file.buffer);
    const exportFilter = `calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}`;
    const command = `soffice --headless --convert-to "pdf:${exportFilter}" --outdir ${TMP_DIR} ${inputPath}`;
    console.log(`[NexusConverter] Ejecutando comando directo: ${command}`);
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`[NexusConverter] Error en 'soffice': ${error.message}`);
            fs.unlink(inputPath, () => {});
            return res.status(500).json({ success: false, error: 'Fallo en la conversión del documento.', details: stderr });
        }
        const finalPdfPath = path.join(TMP_DIR, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        res.sendFile(finalPdfPath, (err) => {
            fs.unlink(inputPath, () => {});
            fs.unlink(finalPdfPath, () => {});
            if (err) console.error("Error al enviar archivo PDF:", err);
        });
    });
});

/**
 * [NUEVO Y MEJORADO] Endpoint para descargar y convertir videos de YouTube.
 * @route POST /convert/youtube
 */
app.post('/convert/youtube', async (req, res) => {
    try {
        const { youtubeUrl, format = 'mp4', videoBitrate = '1000k', audioBitrate = '128k' } = req.body;

        if (!youtubeUrl || !ytdl.validateURL(youtubeUrl)) {
            return res.status(400).json({ success: false, error: 'Se requiere una URL de YouTube válida.' });
        }

        console.log(`[NexusConverter] Iniciando descarga y conversión de: ${youtubeUrl}`);

        // --- MEJORA CLAVE ---
        // 1. Seleccionamos un formato que tenga video y audio explícitamente.
        // 2. Añadimos un listener de errores al stream de ytdl.
        const videoStream = ytdl(youtubeUrl, { 
            filter: 'audioandvideo',
            quality: 'highestvideo'
        });

        videoStream.on('error', (err) => {
            console.error('[NexusConverter] Error en el stream de YTDL:', err.message);
            // Si el stream falla, no continuamos y evitamos que ffmpeg cree un archivo vacío.
            if (!res.headersSent) {
                 res.status(500).json({ success: false, error: 'Fallo al descargar el video de YouTube.', details: err.message });
            }
        });
        // --------------------

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const outputPath = path.join(TMP_DIR, `output-${uniqueSuffix}.${format}`);

        ffmpeg(videoStream)
            .videoBitrate(videoBitrate)
            .audioBitrate(audioBitrate)
            .toFormat(format)
            .on('error', (err) => {
                console.error('[NexusConverter] Error en FFMPEG (YouTube):', err);
                if (!res.headersSent) {
                    res.status(500).json({ success: false, error: 'Fallo en la conversión del video de YouTube.', details: err.message });
                }
            })
            .on('end', () => {
                console.log('[NexusConverter] Conversión de YouTube finalizada con éxito.');
                res.setHeader('Content-Type', `video/${format}`);
                res.sendFile(outputPath, (err) => {
                    fs.unlink(outputPath, () => {}); // Cleanup
                    if (err) console.error("Error al enviar archivo de YouTube:", err);
                });
            })
            .save(outputPath);

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/youtube:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
        }
    }
});


// Ruta de Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', version: '2.2.1', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[NexusDev] NexusConverter service v2.2.1 está listo y escuchando en el puerto ${PORT}`);
});