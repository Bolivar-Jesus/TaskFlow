/**
 * TaskFlow - Prueba 3: Distribución de Carga (Round Robin)
 * 
 * Objetivo: Enviar una serie de tareas y comprobar que el algoritmo Round Robin
 * las reparte equitativamente entre el Trabajador A y el Trabajador B.
 */

const { setupTestCluster, sendTask, getMetrics } = require('./test-helper');
const { performance } = require('perf_hooks');

async function runLoadDistributionTest() {
  console.log('\n======================================================');
  console.log('  EJECUTANDO PRUEBA 3: DISTRIBUCIÓN DE CARGA (ROUND ROBIN)');
  console.log('======================================================');

  const cluster = await setupTestCluster();
  const startTime = performance.now();

  try {
    const TASK_COUNT = 8;
    const LIMIT = 300000;
    console.log(`[PRUEBA 3] Enviando ${TASK_COUNT} tareas consecutivas para verificar Round Robin...`);

    const tasks = [];
    for (let i = 0; i < TASK_COUNT; i++) {
      const task = await sendTask(LIMIT);
      tasks.push(task);
      console.log(`  - Tarea #${i + 1} (${task.id}) asignada a: ${task.workerAssigned} (Hilo #${task.threadId})`);
    }

    const totalDuration = parseFloat((performance.now() - startTime).toFixed(2));

    // Conteo por trabajador en este lote
    const countA = tasks.filter(t => t.workerAssigned.includes('Trabajador A')).length;
    const countB = tasks.filter(t => t.workerAssigned.includes('Trabajador B')).length;

    console.log(`[PRUEBA 3] Distribución obtenida en este lote:`);
    console.log(`  - Trabajador A: ${countA} tareas (${Math.round((countA / TASK_COUNT) * 100)}%)`);
    console.log(`  - Trabajador B: ${countB} tareas (${Math.round((countB / TASK_COUNT) * 100)}%)`);

    // Validar distribución equitativa
    if (countA === 0 || countB === 0) {
      throw new Error(`Distribución desbalanceada: Trabajador A=${countA}, Trabajador B=${countB}`);
    }

    // En Round Robin puro con 8 tareas deben repartirse 4 y 4 (o con diferencia máx de 1)
    if (Math.abs(countA - countB) > 1) {
      throw new Error(`Desbalance en Round Robin excesivo: A=${countA}, B=${countB}`);
    }

    const avgCpuTime = parseFloat((tasks.reduce((a, t) => a + (t.executionTimeMs || 0), 0) / TASK_COUNT).toFixed(2));
    const metrics = await getMetrics();

    const result = {
      name: 'Prueba 3 - Distribución de Carga',
      success: true,
      tasksSent: TASK_COUNT,
      tasksCompleted: tasks.filter(t => t.status === 'completada').length,
      tasksFailed: 0,
      totalDurationMs: totalDuration,
      avgProcessingTimeMs: avgCpuTime,
      details: `Distribución Round Robin perfecta: Trabajador A (${countA} tareas) | Trabajador B (${countB} tareas).`,
      workerStats: metrics.tasksPerWorker
    };

    console.log('\n✔ PRUEBA 3 SUPERADA EXITOSAMENTE');
    return result;
  } catch (err) {
    console.error('\n❌ ERROR EN PRUEBA 3:', err.message);
    return {
      name: 'Prueba 3 - Distribución de Carga',
      success: false,
      tasksSent: 8,
      tasksCompleted: 0,
      tasksFailed: 8,
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
  runLoadDistributionTest().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = runLoadDistributionTest;
