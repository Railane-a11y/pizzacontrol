const sharp = require('sharp');
const fs = require('fs');

const inputFile = 'C:\\Users\\marll\\.gemini\\antigravity\\brain\\0d33abde-8ef2-4ef2-b798-37254af034d8\\pizza_control_icon_v2_1773927637165.png';

async function generateIcons() {
    console.log('Iniciando processamento com sharp...');
    const image = sharp(inputFile);
    
    // 512x512 and 192x192 with rounded corners (transparent outside)
    const generateTransparent = async (size, filename) => {
        const radius = Math.round(size * 0.225); // iOS style radius
        const rect = Buffer.from(
            `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`
        );
        
        await sharp(inputFile)
            .resize(size, size)
            .composite([{ input: rect, blend: 'dest-in' }])
            .toFile(filename);
        console.log(`Gerado \${filename}`);
    };

    // Solid background for Apple
    const generateSolid = async (size, filename) => {
        await sharp(inputFile)
            .resize(size, size)
            .toFile(filename);
        console.log(`Gerado \${filename}`);
    };

    try {
        await generateTransparent(512, 'icon-512x512.png');
        await generateTransparent(192, 'icon-192x192.png');
        await generateSolid(180, 'apple-touch-icon.png');
        await generateTransparent(32, 'favicon-32x32.png');
        await generateTransparent(16, 'favicon-16x16.png');
        console.log('Todos os ícones gerados com sucesso!');
    } catch (e) {
        console.error('Erro gerando icones:', e);
    }
}

generateIcons();
