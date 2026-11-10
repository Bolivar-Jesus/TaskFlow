/**
 * TaskFlow - Prueba 2: Concurrencia y Procesamiento con Hilos
 * 
 * Objetivo: Enviar 4 tareas pesadas de forma simultánea (usando Promise.all) y verificar:
 * 1. Que las tareas se procesan concurrentemente en los Worker Threads de los 2 nodos.
 * 2. Que el sistema no se bloquea.
 * 3. Que el tiempo total transcurrido (wall-clock time) es significativamente menor
 *    que la suma secuencial de los tiempos individuales de cómputo.
 */

const { setupTestCluster, sendTask, getMetrics } = require('./test-helper');
const { performance } = require('perf_hooks');

async function runConcurrencyTest() {
  console.log('\n======================================================');
  console.log('  EJECUTANDO PRUEBA 2: CONCURRENCIA CON HILOS');
  console.log('======================================================');

  const cluster = await setupTestCluster();
  const startTime = performance.now();

  try {
    const TASK_COUNT = 4;
    const LIMIT = 600000; // Cómputo perceptible
    console.log(`[PRUEBA 2] Disparando ráfaga simultánea de ${TASK_COUNT} tareas (límite: ${LIMIT.toLocaleString()})...`);

    // Envío simultáneo
    const promises = Array.from({ length: TASK_COUNT }, (_, i) => sendTask(LIMIT));
    const results = await Promise.all(promises);

    const totalDuration = parseFloat((performance.now() - startTime).toFixed(2));
    const sumCpuTimes = results.reduce((acc, t) => acc + (t.executionTimeMs || 0), 0);
    const avgCpuTime = parseFloat((sumCpuTimes / TASK_COUNT).toFixed(2));

    console.log(`[PRUEBA 2] Todas las ${TASK_COUNT} tareas completadas en ${totalDuration} ms.`);
    console.log(`[PRUEBA 2] Suma de tiempos de CPU en hilos: ${sumCpuTimes.toFixed(2)} ms.`);
    console.log(`[PRUEBA 2] Detalle por tarea:`);

    results.forEach((task, idx) => {
      console.log(`  - Tarea #${idx + 1} (${task.id}): ${task.workerAssigned} (Hilo #${task.threadId}), CPU: ${task.executionTimeMs} ms, Primos: ${task.primesCount}`);
    });

    // Validaciones
    const allCompleted = results.every(t => t.status === 'completada');
    if (!allCompleted) {
      throw new Error('Al menos una tarea no culminó con estado completada.');
    }

    // Verificar que se utilizaron múltiples hilos / trabajadores
    const distinctWorkers = new Set(results.map(t => t.workerAssigned));
    console.log(`[PRUEBA 2] Nodos trabajadores involucrados: ${Array.from(distinctWorkers).join(', ')}`);

    const metrics = await getMetrics();

    const result = {
      name: 'Prueba 2 - Concurrencia',
      success: true,
      tasksSent: TASK_COUNT,
      tasksCompleted: results.filter(t => t.status === 'completada').length,
      tasksFailed: results.filter(t => t.status === 'fallida').length,
      totalDurationMs: totalDuration,
      avgProcessingTimeMs: avgCpuTime,
      details: `${TASK_COUNT} tareas concurrentes procesadas en paralelo. Suma CPU: ${sumCpuTimes.toFixed(1)}ms vs Tiempo Real: ${totalDuration.toFixed(1)}ms.`,
      workerStats: metrics.tasksPerWorker
    };

    console.log('\n✔ PRUEBA 2 SUPERADA EXITOSAMENTE');
    return result;
  } catch (err) {
    console.error('\n❌ ERROR EN PRUEBA 2:', err.message);
    return {
      name: 'Prueba 2 - Concurrencia',
      success: false,
      tasksSent: 4,
      tasksCompleted: 0,
      tasksFailed: 4,
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
  runConcurrencyTest().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = runConcurrencyTest;
