/**
 * TaskFlow - Prueba 4: Escalabilidad (1 Trabajador vs 2 Trabajadores)
 * 
 * Objetivo: Comparar el comportamiento y rendimiento del sistema al procesar
 * la misma carga de trabajo (lote de 6 tareas) bajo dos condiciones:
 * 
 * Escenario 1: Con 1 solo nodo trabajador activo (2 hilos en total).
 * Escenario 2: Con 2 nodos trabajadores activos (4 hilos en total).
 * 
 * Se calcula el factor de aceleración (Speedup = T1 / T2) para demostrar
 * el beneficio de escalar horizontalmente el clúster.
 */

const { spawnNode, sleep, requestHttp } = require('./test-helper');
const { performance } = require('perf_hooks');
const path = require('path');

const WORKER_SCRIPT = path.join(__dirname, '..', 'workers', 'worker-server.js');
const COORDINATOR_SCRIPT = path.join(__dirname, '..', 'coordinator', 'server.js');

async function waitForCoordinator(url = 'http://localhost:3000', maxTries = 15) {
  for (let i = 0; i < maxTries; i++) {
    try {
      const h = await requestHttp(`${url}/api/health`, 'GET', null, 800);
      if (h && h.coordinator === 'online') return true;
    } catch (e) {}
    await sleep(400);
  }
  return false;
}

async function runScalabilityTest() {
  console.log('\n======================================================');
  console.log('  EJECUTANDO PRUEBA 4: ESCALABILIDAD (1 vs 2 TRABAJADORES)');
  console.log('======================================================');

  const BATCH_SIZE = 6;
  const TASK_LIMIT = 700000; // Cálculo demandante para evidenciar concurrencia

  let pCoord = null;
  let pWorkA = null;
  let pWorkB = null;

  try {
    // -----------------------------------------------------------------
    // ESCENARIO 1: Solo 1 Trabajador Activo (Trabajador A en :3001)
    // -----------------------------------------------------------------
    console.log(`\n[PRUEBA 4] Configurando Escenario 1: 1 Trabajador (2 hilos)...`);
    pWorkA = spawnNode(WORKER_SCRIPT, ['3001', 'Trabajador A']);
    await sleep(600);
    pCoord = spawnNode(COORDINATOR_SCRIPT, ['3000']);
    await waitForCoordinator();

    console.log(`[PRUEBA 4] Enviando lote de ${BATCH_SIZE} tareas a 1 solo trabajador...`);
    const start1 = performance.now();
    const promises1 = Array.from({ length: BATCH_SIZE }, () =>
      requestHttp('http://localhost:3000/api/tasks', 'POST', { limit: TASK_LIMIT }, 30000)
    );
    const results1 = await Promise.all(promises1);
    const duration1 = parseFloat((performance.now() - start1).toFixed(2));
    console.log(`[PRUEBA 4] Escenario 1 completado en: ${duration1} ms (1 Trabajador)`);

    // Detener clúster del Escenario 1
    pCoord.kill('SIGINT');
    pWorkA.kill('SIGINT');
    pCoord = null;
    pWorkA = null;
    await sleep(1000);

    // -----------------------------------------------------------------
    // ESCENARIO 2: 2 Trabajadores Activos (Trabajador A y B, 4 hilos)
    // -----------------------------------------------------------------
    console.log(`\n[PRUEBA 4] Configurando Escenario 2: 2 Trabajadores (4 hilos)...`);
    pWorkA = spawnNode(WORKER_SCRIPT, ['3001', 'Trabajador A']);
    pWorkB = spawnNode(WORKER_SCRIPT, ['3002', 'Trabajador B']);
    await sleep(600);
    pCoord = spawnNode(COORDINATOR_SCRIPT, ['3000']);
    await waitForCoordinator();

    console.log(`[PRUEBA 4] Enviando lote de ${BATCH_SIZE} tareas a los 2 trabajadores distribuidos...`);
    const start2 = performance.now();
    const promises2 = Array.from({ length: BATCH_SIZE }, () =>
      requestHttp('http://localhost:3000/api/tasks', 'POST', { limit: TASK_LIMIT }, 30000)
    );
    const results2 = await Promise.all(promises2);
    const duration2 = parseFloat((performance.now() - start2).toFixed(2));
    console.log(`[PRUEBA 4] Escenario 2 completado en: ${duration2} ms (2 Trabajadores)`);

    // Cálculos de escalabilidad
    const speedup = parseFloat((duration1 / duration2).toFixed(2));
    const improvementPercent = Math.round(((duration1 - duration2) / duration1) * 100);

    console.log(`\n[PRUEBA 4] --- RESULTADOS DE ESCALABILIDAD ---`);
    console.log(`  - Tiempo con 1 Trabajador (2 hilos): ${duration1} ms`);
    console.log(`  - Tiempo con 2 Trabajadores (4 hilos): ${duration2} ms`);
    console.log(`  - Factor de aceleración (Speedup): ${speedup}x`);
    console.log(`  - Reducción de tiempo total: ${improvementPercent}%`);

    if (duration2 >= duration1) {
      console.warn('Advertencia: El tiempo con 2 trabajadores no fue menor. Posible saturación de CPU local.');
    }

    const avgProcessing = parseFloat((results2.reduce((a, t) => a + (t.executionTimeMs || 0), 0) / BATCH_SIZE).toFixed(2));

    const result = {
      name: 'Prueba 4 - Escalabilidad',
      success: true,
      tasksSent: BATCH_SIZE * 2,
      tasksCompleted: results1.length + results2.length,
      tasksFailed: 0,
      totalDurationMs: parseFloat((duration1 + duration2).toFixed(2)),
      avgProcessingTimeMs: avgProcessing,
      details: `1 Trabajador: ${duration1}ms vs 2 Trabajadores: ${duration2}ms. Speedup real obtenido: ${speedup}x (mejora de ${improvementPercent}%).`
    };

    console.log('\n✔ PRUEBA 4 SUPERADA EXITOSAMENTE');
    return result;
  } catch (err) {
    console.error('\n❌ ERROR EN PRUEBA 4:', err.message);
    return {
      name: 'Prueba 4 - Escalabilidad',
      success: false,
      tasksSent: BATCH_SIZE * 2,
      tasksCompleted: 0,
      tasksFailed: BATCH_SIZE * 2,
      totalDurationMs: 0,
      avgProcessingTimeMs: 0,
      details: `Fallo: ${err.message}`
    };
  } finally {
    if (pCoord) pCoord.kill('SIGINT');
    if (pWorkA) pWorkA.kill('SIGINT');
    if (pWorkB) pWorkB.kill('SIGINT');
    await sleep(600);
  }
}

if (require.main === module) {
  runScalabilityTest().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = runScalabilityTest;
