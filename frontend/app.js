/**
 * TaskFlow - Lógica de Cliente Web (Frontend Vanilla JS)
 * 
 * Gestiona el formulario de envío, la ejecución en ráfaga y el sondeo periódico
 * (polling) cada 1.5s para mantener sincronizado el estado de los nodos,
 * los hilos de ejecución, las métricas y la tabla de resultados.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos DOM del Formulario
  const taskForm = document.getElementById('task-form');
  const limitInput = document.getElementById('limit-input');
  const btnSubmit = document.getElementById('btn-submit');
  const btnBurst = document.getElementById('btn-burst');
  const presetButtons = document.querySelectorAll('.btn-preset');

  // Elementos DOM de Estado del Coordinador
  const coordinatorIndicator = document.getElementById('coordinator-indicator');
  const coordinatorStatusText = document.getElementById('coordinator-status-text');
  const badgeCoordinator = document.getElementById('badge-coordinator');
  const coordinatorUptime = document.getElementById('coordinator-uptime');

  // Elementos DOM de Trabajador A
  const badgeWorkerA = document.getElementById('badge-worker-a');
  const waThread1 = document.getElementById('wa-thread-1');
  const waThread2 = document.getElementById('wa-thread-2');
  const waQueue = document.getElementById('wa-queue');
  const waProcessed = document.getElementById('wa-processed');

  // Elementos DOM de Trabajador B
  const badgeWorkerB = document.getElementById('badge-worker-b');
  const wbThread1 = document.getElementById('wb-thread-1');
  const wbThread2 = document.getElementById('wb-thread-2');
  const wbQueue = document.getElementById('wb-queue');
  const wbProcessed = document.getElementById('wb-processed');

  // Elementos DOM de Métricas
  const metricTotal = document.getElementById('metric-total');
  const metricCompleted = document.getElementById('metric-completed');
  const metricFailed = document.getElementById('metric-failed');
  const metricAvgTime = document.getElementById('metric-avg-time');
  const loadBalanceRatio = document.getElementById('load-balance-ratio');
  const barWorkerA = document.getElementById('bar-worker-a');
  const barWorkerB = document.getElementById('bar-worker-b');

  // Elementos DOM de Tabla
  const tasksTbody = document.getElementById('tasks-tbody');

  // -------------------------------------------------------------
  // Configuración de Botones de Acceso Rápido (Presets)
  // -------------------------------------------------------------
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      limitInput.value = btn.getAttribute('data-limit');
    });
  });

  // -------------------------------------------------------------
  // Envío de Tarea Individual
  // -------------------------------------------------------------
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const limit = parseInt(limitInput.value, 10);
    if (!limit || limit < 1) return;

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando...';

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit })
      });

      if (!response.ok) {
        const err = await response.json();
        alert(`Error al enviar tarea: ${err.error || response.statusText}`);
      } else {
        await refreshAllData();
      }
    } catch (err) {
      console.error('Error al enviar tarea:', err);
      alert(`Error de red al conectar con el Coordinador: ${err.message}`);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>▶ Enviar Tarea</span>';
    }
  });

  // -------------------------------------------------------------
  // Envío en Ráfaga Concurrente (4 Tareas en Paralelo)
  // -------------------------------------------------------------
  btnBurst.addEventListener('click', async () => {
    const limit = parseInt(limitInput.value, 10) || 500000;
    btnBurst.disabled = true;
    btnBurst.innerHTML = '<span>⚡ Ejecutando Ráfaga...</span>';

    try {
      // Disparo simultáneo de 4 tareas para saturar ambos trabajadores (2 hilos c/u)
      const tasksPromises = [1, 2, 3, 4].map(() =>
        fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit })
        })
      );

      await Promise.all(tasksPromises);
      await refreshAllData();
    } catch (err) {
      console.error('Error en ráfaga concurrente:', err);
      alert(`Error durante la ráfaga: ${err.message}`);
    } finally {
      btnBurst.disabled = false;
      btnBurst.innerHTML = '<span>⚡ Ráfaga Concurrente (4 Tareas)</span>';
    }
  });

  // -------------------------------------------------------------
  // Sondeo Periódico y Actualización del Dashboard
  // -------------------------------------------------------------
  async function refreshAllData() {
    try {
      // Consultar endpoints en paralelo vía el Proxy (puerto 3000)
      const [healthRes, workersRes, metricsRes, tasksRes] = await Promise.all([
        fetch('/api/health').catch(() => null),
        fetch('/api/workers').catch(() => null),
        fetch('/api/metrics').catch(() => null),
        fetch('/api/tasks').catch(() => null)
      ]);

      // 1. Actualizar estado del Coordinador
      if (healthRes && healthRes.ok) {
        const health = await healthRes.json();
        coordinatorIndicator.innerHTML = `
          <span class="status-dot online"></span>
          <span class="status-text">Coordinador en Línea (:3000)</span>
        `;
        badgeCoordinator.className = 'badge badge-success';
        badgeCoordinator.textContent = 'En Línea';
        coordinatorUptime.textContent = `${Math.floor(health.uptimeSeconds)}s`;
      } else {
        coordinatorIndicator.innerHTML = `
          <span class="status-dot offline"></span>
          <span class="status-text">Coordinador Desconectado</span>
        `;
        badgeCoordinator.className = 'badge badge-danger';
        badgeCoordinator.textContent = 'Desconectado';
      }

      // 2. Actualizar estado de los Trabajadores y sus Hilos
      if (workersRes && workersRes.ok) {
        const workers = await workersRes.json();
        const workerA = workers.find(w => w.id === 'worker-a');
        const workerB = workers.find(w => w.id === 'worker-b');

        updateWorkerUI(workerA, badgeWorkerA, waThread1, waThread2, waQueue, waProcessed);
        updateWorkerUI(workerB, badgeWorkerB, wbThread1, wbThread2, wbQueue, wbProcessed);
      }

      // 3. Actualizar Métricas Generales y Balanceo
      if (metricsRes && metricsRes.ok) {
        const metrics = await metricsRes.json();
        metricTotal.textContent = metrics.totalTasksReceived;
        metricCompleted.textContent = metrics.completedTasks;
        metricFailed.textContent = metrics.failedTasks;
        metricAvgTime.textContent = `${metrics.averageProcessingTimeMs} ms`;

        const countA = metrics.tasksPerWorker['Trabajador A'] || 0;
        const countB = metrics.tasksPerWorker['Trabajador B'] || 0;
        const total = countA + countB;

        loadBalanceRatio.textContent = `Trabajador A: ${countA} | Trabajador B: ${countB}`;

        if (total > 0) {
          const pctA = Math.round((countA / total) * 100);
          const pctB = 100 - pctA;
          barWorkerA.style.width = `${pctA}%`;
          barWorkerA.textContent = `Trabajador A (${pctA}%)`;
          barWorkerB.style.width = `${pctB}%`;
          barWorkerB.textContent = `Trabajador B (${pctB}%)`;
        } else {
          barWorkerA.style.width = '50%';
          barWorkerA.textContent = 'Trabajador A (50%)';
          barWorkerB.style.width = '50%';
          barWorkerB.textContent = 'Trabajador B (50%)';
        }
      }

      // 4. Actualizar Tabla de Tareas
      if (tasksRes && tasksRes.ok) {
        const tasks = await tasksRes.json();
        renderTasksTable(tasks);
      }

    } catch (err) {
      console.warn('Fallo transitorio al consultar API:', err.message);
    }
  }

  function updateWorkerUI(workerData, badgeElem, thread1Elem, thread2Elem, queueElem, processedElem) {
    if (!workerData || workerData.status !== 'online') {
      badgeElem.className = 'badge badge-danger';
      badgeElem.textContent = 'Fuera de Línea';
      thread1Elem.className = 'thread-dot';
      thread2Elem.className = 'thread-dot';
      queueElem.textContent = '0';
      return;
    }

    badgeElem.className = 'badge badge-success';
    badgeElem.textContent = 'En Línea';
    queueElem.textContent = workerData.queueLength || 0;
    processedElem.textContent = workerData.tasksProcessed || 0;

    // Visualizar hilos activos
    const active = workerData.activeThreads || 0;
    if (active >= 2) {
      thread1Elem.className = 'thread-dot busy';
      thread2Elem.className = 'thread-dot busy';
    } else if (active === 1) {
      thread1Elem.className = 'thread-dot busy';
      thread2Elem.className = 'thread-dot';
    } else {
      thread1Elem.className = 'thread-dot';
      thread2Elem.className = 'thread-dot';
    }
  }

  function renderTasksTable(tasks) {
    if (!tasks || tasks.length === 0) {
      tasksTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="9">No hay tareas registradas aún. ¡Envía una tarea arriba!</td>
        </tr>
      `;
      return;
    }

    tasksTbody.innerHTML = tasks.map(task => {
      const timeFormatted = task.createdAt 
        ? new Date(task.createdAt).toLocaleTimeString() 
        : '-';

      const sampleText = task.samplePrimes && task.samplePrimes.length > 0
        ? `<span class="sample-code" title="${task.samplePrimes.join(', ')}">${task.samplePrimes.slice(0, 4).join(', ')}...</span>`
        : '-';

      const primesText = task.primesCount !== null 
        ? task.primesCount.toLocaleString() 
        : '-';

      const executionTime = task.executionTimeMs !== null 
        ? `${task.executionTimeMs} ms` 
        : '-';

      const threadText = task.threadId 
        ? `Hilo #${task.threadId}` 
        : '-';

      return `
        <tr>
          <td><strong>${task.id}</strong></td>
          <td>${task.limit.toLocaleString()}</td>
          <td><span class="task-badge ${task.status}">${task.status}</span></td>
          <td>${task.workerAssigned || '-'}</td>
          <td>${threadText}</td>
          <td>${executionTime}</td>
          <td><strong>${primesText}</strong></td>
          <td>${sampleText}</td>
          <td style="color: var(--text-muted); font-size: 0.8rem;">${timeFormatted}</td>
        </tr>
      `;
    }).join('');
  }

  // Primera consulta inmediata y ciclo de polling cada 1500ms
  refreshAllData();
  setInterval(refreshAllData, 1500);
});
