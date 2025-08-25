🚀 Microservicio de conversión multi-formato con marca de agua diagonal gigante configurable.

✨ Novedades v4.1.0

✅ Nuevo endpoint /convert/image mejorado.

✅ Marca de agua diagonal, gigante y centrada detrás del producto.

✅ Control total por parámetros:

layout:

sheet → ficha 800×1000 (imagen arriba, logo abajo).

overlay → foto a pantalla completa con watermark al fondo.

watermarkMode: diagonal | center

watermarkOpacity: 0..1 → nivel de transparencia (ej. 0.3, 0.6, 1.0)

watermarkScale: factor relativo al ancho del lienzo (ej. 2.5 para cubrir toda la foto)

watermarkAngle: grados de rotación (ej. 45)
