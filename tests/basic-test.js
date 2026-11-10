/**
 * TaskFlow - Prueba 1: Funcionamiento Básico
 * 
 * Objetivo: Enviar una tarea al servidor principal (Coordinador) y comprobar:
 * 1. Que se recibe y procesa correctamente.
 * 2. Que devuelve el resultado exacto del cálculo de números primos.
 * 3. Que el estado cambia a 'completada'.
 * 4. Que identifica qué trabajador e hilo la procesaron.
 */

const { setupTestCluster, sendTask, getMetrics } = require('./test-helper');
const { performance } = require('perf_hooks');

async function runBasicTest() {
  console.log('\n======================================================');
  console.log('  EJECUTANDO PRUEBA 1: FUNCIONAMIENTO BÁSICO');
  console.log('======================================================');

  const cluster = await setupTestCluster();
  const startTime = performance.now();

  try {
    const testLimit = 500000;
    console.log(`[PRUEBA 1] Enviando tarea con límite: ${testLimit.toLocaleString()} primos...`);

    const task = await sendTask(testLimit);
    const totalDuration = parseFloat((performance.now() - startTime).toFixed(2));

    console.log(`[PRUEBA 1] Respuesta recibida:`, {
      id: task.id,
      estado: task.status,
      trabajador: task.workerAssigned,
      hilo: task.threadId,
      primosHallados: task.primesCount,
      tiempoComputoMs: task.executionTimeMs,
      tiempoTotalRedMs: totalDuration
    });

    // Validaciones
    if (task.status !== 'completada') {
      throw new Error(`Estado esperado 'completada', recibido: '${task.status}'`);
    }

    // Hasta 500,000 hay exactamente 41,538 números primos (valor matemático constante)
    const EXPECTED_PRIMES = 41538;
    if (task.primesCount !== EXPECTED_PRIMES) {
      throw new Error(`Conteo de primos incorrecto. Esperado: ${EXPECTED_PRIMES}, Obtenido: ${task.primesCount}`);
    }

    if (!task.workerAssigned || !task.threadId) {
      throw new Error(`Información de trabajador/hilo ausente en la respuesta.`);
    }

    const metrics = await getMetrics();

    const result = {
      name: 'Prueba 1 - Funcionamiento Básico',
      success: true,
      tasksSent: 1,
      tasksCompleted: 1,
      tasksFailed: 0,
      totalDurationMs: totalDuration,
      avgProcessingTimeMs: task.executionTimeMs,
      details: `Tarea ${task.id} completada exitosamente por ${task.workerAssigned} (Hilo #${task.threadId}). Primos hallados: ${task.primesCount}.`,
      workerStats: metrics.tasksPerWorker
    };

    console.log('\n✔ PRUEBA 1 SUPERADA EXITOSAMENTE');
    return result;
  } catch (err) {
    console.error('\n❌ ERROR EN PRUEBA 1:', err.message);
    return {
      name: 'Prueba 1 - Funcionamiento Básico',
      success: false,
      tasksSent: 1,
      tasksCompleted: 0,
      tasksFailed: 1,
      totalDurationMs: parseFloat((performance.now() - startTime).toFixed(2)),
      avgProcessingTimeMs: 0,
      details: `Fallo: ${err.message}`
    };
  } finally {
    if (cluster.startedLocally) {
      await cluster.teardown();
    }
  }
}

if (require.main === module) {
  runBasicTest().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = runBasicTest;
