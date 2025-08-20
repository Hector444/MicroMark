/**
 * [NexusDev] - NexusConverter Microservice v2.3.0
 *
 * Mission: Provide a multi-format, high-performance API for converting local files and YouTube videos.
 * v2.3.0 Update: Replaced ytdl-core with direct yt-dlp execution for superior reliability against YouTube's anti-scraping measures.
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

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
 * [RECONSTRUIDO] Endpoint de YouTube ahora usa yt-dlp para máxima fiabilidad.
 * @route POST /convert/youtube
 */
app.post('/convert/youtube', (req, res) => {
    try {
        const { youtubeUrl, format = 'mp4' } = req.body;

        if (!youtubeUrl) { // yt-dlp no tiene un validador simple, así que solo chequeamos que exista.
            return res.status(400).json({ success: false, error: 'Se requiere una URL de YouTube.' });
        }
        
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const outputPath = path.join(TMP_DIR, `youtube_video-${uniqueSuffix}.${format}`);
        
        // Comando directo a yt-dlp.
        // -f 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]': Pide el mejor video y audio por separado y los une.
        // --output: Especifica la ruta de salida.
        const command = `yt-dlp -f 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]' --merge-output-format mp4 "${youtubeUrl}" -o "${outputPath}"`;
        
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
    res.status(200).json({ status: 'ok', version: '2.3.0', timestamp: new Date().toISOString() });
});
app.listen(PORT, () => {
  console.log(`[NexusDev] NexusConverter service v2.3.0 está listo y escuchando en el puerto ${PORT}`);
});