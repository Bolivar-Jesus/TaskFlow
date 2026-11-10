/**
 * TaskFlow - Hilo de Ejecución de Tarea (Worker Thread)
 * 
 * Este archivo es ejecutado de forma aislada por un hilo nativo del módulo
 * worker_threads de Node.js. Realiza un cálculo intensivo de CPU (números primos)
 * sin bloquear el bucle de eventos (Event Loop) del proceso principal del trabajador.
 */

const { parentPort, threadId } = require('worker_threads');
const { performance } = require('perf_hooks');

/**
 * Determina si un número es primo mediante divisiones sucesivas optimizadas (6k ± 1).
 * @param {number} n 
 * @returns {boolean}
 */
function isPrime(n) {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/**
 * Calcula la cantidad de números primos hasta un límite dado y recopila una muestra.
 * @param {number} limit 
 * @returns {{ count: number, samplePrimes: number[] }}
 */
function calculatePrimes(limit) {
  let count = 0;
  const samplePrimes = [];
  const maxSample = 10;

  for (let i = 2; i <= limit; i++) {
    if (isPrime(i)) {
      count++;
      if (samplePrimes.length < maxSample) {
        samplePrimes.push(i);
      }
    }
  }

  return { count, samplePrimes };
}

// Escuchar mensajes entrantes del hilo principal (Worker Server)
if (parentPort) {
  parentPort.on('message', (taskData) => {
    const { taskId, limit, internalThreadIndex } = taskData;
    const startTime = performance.now();

    try {
      // Validación defensiva
      const parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        throw new Error(`Límite inválido proporcionado: ${limit}`);
      }

      // Ejecutar cálculo de CPU intensivo
      const { count, samplePrimes } = calculatePrimes(parsedLimit);
      const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

      // Devolver resultado al hilo principal
      parentPort.postMessage({
        success: true,
        taskId,
        primesCount: count,
        samplePrimes,
        limit: parsedLimit,
        executionTimeMs,
        threadId: internalThreadIndex !== undefined ? internalThreadIndex : threadId
      });
    } catch (err) {
      const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
      parentPort.postMessage({
        success: false,
        taskId,
        error: err.message,
        executionTimeMs,
        threadId: internalThreadIndex !== undefined ? internalThreadIndex : threadId
      });
    }
  });
}
