const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const swPath = path.join(projectDir, 'sw.js');
const lastSavePath = path.join(projectDir, '.last_save');

console.log("==================================================");
console.log("   ANALIZADOR DE CAMBIOS Y CONTROL DE VERSIONES   ");
console.log("==================================================\n");

// 1. Obtener timestamp del último guardado
let lastSaveTime = 0;
if (fs.existsSync(lastSavePath)) {
  try {
    lastSaveTime = parseInt(fs.readFileSync(lastSavePath, 'utf8')) || 0;
  } catch (e) {
    lastSaveTime = 0;
  }
}

// 2. Escanear archivos recursivamente para ver cuáles fueron modificados
const modifiedFiles = [];
function scanDir(dir) {
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Ignorar carpeta oculta .github y node_modules si existieran
      if (file !== '.github' && file !== '.git') {
        scanDir(filePath);
      }
    } else {
      // Ignorar archivos de control interno y scripts locales
      if (
        file !== '.last_save' && 
        file !== 'guardar_cambios.js' && 
        file !== 'guardar_cambios.bat' && 
        file !== 'import_booking.js' && 
        file !== 'sincronizar_booking.bat' &&
        file !== 'scratch_replace.js'
      ) {
        if (stat.mtimeMs > lastSaveTime) {
          const relativePath = path.relative(projectDir, filePath);
          modifiedFiles.push(relativePath);
        }
      }
    }
  });
}

scanDir(projectDir);

// 3. Si no hay archivos modificados, avisar y salir
if (modifiedFiles.length === 0) {
  console.log("No se detectaron nuevos cambios en los archivos del proyecto desde la última vez.");
  console.log("Tu web está al día en tu computadora.");
  console.log("\nPresiona cualquier tecla para salir.");
  process.exit(0);
}

// 4. Si hay cambios, incrementar la versión en sw.js
console.log("Detectando cambios...");
let swUpdated = false;
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  
  // Buscar const CACHE_NAME = 'malargue-cache-vXX';
  const cacheRegex = /const CACHE_NAME = 'malargue-cache-v(\d+)';/;
  const match = swContent.match(cacheRegex);
  
  if (match) {
    const currentVersion = parseInt(match[1]);
    const newVersion = currentVersion + 1;
    const oldStr = match[0];
    const newStr = `const CACHE_NAME = 'malargue-cache-v${newVersion}';`;
    
    swContent = swContent.replace(oldStr, newStr);
    fs.writeFileSync(swPath, swContent, 'utf8');
    swUpdated = true;
    
    console.log(`-> Versión de caché incrementada en sw.js: v${currentVersion} a v${newVersion}!`);
    
    // Añadir sw.js a la lista de modificados si no estaba
    if (!modifiedFiles.includes('sw.js')) {
      modifiedFiles.push('sw.js');
    }
  }
}

// 5. Mostrar al usuario qué archivos debe subir
console.log("\n--------------------------------------------------");
console.log("¡CAMBIOS DETECTADOS Y LISTOS PARA SUBIR!");
console.log("--------------------------------------------------");
console.log("Para que tus clientes vean las modificaciones de inmediato,");
console.log("debes subir (arrastrar) estos archivos a tu GitHub:\n");

modifiedFiles.forEach(file => {
  console.log(` [MODIFICADO] ->  ${file}`);
});

console.log("\n--------------------------------------------------");
console.log("INSTRUCCIONES DE SUBIDA:");
console.log("1. Abre tu repositorio en GitHub.");
console.log("2. Ve a 'Add file' -> 'Upload files'.");
console.log("3. Arrastra los archivos de la lista de arriba.");
console.log("4. Haz clic abajo en 'Commit changes'.");
console.log("--------------------------------------------------");

// 6. Guardar la fecha actual para la próxima comparación
fs.writeFileSync(lastSavePath, Date.now().toString(), 'utf8');
