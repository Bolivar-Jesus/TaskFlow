/**
 * TaskFlow - Orquestador de Inicio Unificado para Windows
 * 
 * Inicia de manera concurrente los tres nodos de la arquitectura distribuida:
 * - Servidor Coordinador (Puerto 3000)
 * - Trabajador A (Puerto 3001)
 * - Trabajador B (Puerto 3002)
 * 
 * Agrupa y etiqueta la salida en consola de cada nodo con colores ANSI
 * y garantiza el apagado limpio de todos los subprocesos con Ctrl+C.
 */

const { spawn } = require('child_process');
const path = require('path');

// Colores ANSI para distinguir la salida de cada nodo en la terminal
const COLORS = {
  reset: '\x1b[0m',
  coordinator: '\x1b[32m', // Verde
  workerA: '\x1b[35m',     // Magenta
  workerB: '\x1b[36m',     // Cian
  system: '\x1b[33m'       // Amarillo
};

const processes = [];

function startProcess(name, scriptPath, args, color) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${color}[${name}]${COLORS.reset} ${line}`);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`${color}[${name} ERROR]${COLORS.reset} ${line}`);
      }
    });
  });

  child.on('exit', (code, signal) => {
    if (signal !== 'SIGINT' && signal !== 'SIGTERM' && code !== 0) {
      console.log(`${color}[${name}]${COLORS.reset} Proceso finalizado (código ${code}, señal ${signal})`);
    }
  });

  processes.push({ name, child });
  return child;
}

console.log(`${COLORS.system}================================================================${COLORS.reset}`);
console.log(`${COLORS.system}  TaskFlow - Sistema Distribuido de Procesamiento de Tareas     ${COLORS.reset}`);
console.log(`${COLORS.system}  Iniciando los 3 nodos del sistema distribuido...              ${COLORS.reset}`);
console.log(`${COLORS.system}================================================================${COLORS.reset}`);

// 1. Iniciar Trabajador A (Puerto 3001)
const workerAScript = path.join(__dirname, '..', 'workers', 'worker-server.js');
startProcess('WORKER-A', workerAScript, ['3001', 'Trabajador A'], COLORS.workerA);

// 2. Iniciar Trabajador B (Puerto 3002)
const workerBScript = path.join(__dirname, '..', 'workers', 'worker-server.js');
startProcess('WORKER-B', workerBScript, ['3002', 'Trabajador B'], COLORS.workerB);

// 3. Pequeño retardo de 500ms para asegurar que los trabajadores abran sus puertos antes del coordinador
setTimeout(() => {
  const coordinatorScript = path.join(__dirname, '..', 'coordinator', 'server.js');
  startProcess('COORDINATOR', coordinatorScript, ['3000'], COLORS.coordinator);

  setTimeout(() => {
    console.log(`${COLORS.system}----------------------------------------------------------------${COLORS.reset}`);
    console.log(`${COLORS.system}  Todos los nodos están activos.${COLORS.reset}`);
    console.log(`${COLORS.system}  Abre la interfaz web en: http://localhost:3000${COLORS.reset}`);
    console.log(`${COLORS.system}  Presiona Ctrl+C para detener todos los nodos limpiamente.${COLORS.reset}`);
    console.log(`${COLORS.system}----------------------------------------------------------------${COLORS.reset}`);
  }, 1000);
}, 600);

// Manejo de apagado limpio en Windows (Ctrl+C / SIGINT)
function shutdownAll() {
  console.log(`\n${COLORS.system}Deteniendo todos los nodos distribuidos de TaskFlow...${COLORS.reset}`);
  processes.forEach(({ name, child }) => {
    try {
      child.kill('SIGINT');
    } catch (e) {
      // Ignorar si ya terminó
    }
  });

  // Forzar salida tras breve pausa
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', shutdownAll);
process.on('SIGTERM', shutdownAll);
