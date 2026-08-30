/**
 * ChatNest AI — Evaluation Dashboard Client Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const runSuiteBtn = document.getElementById('runSuiteBtn');
  const overallScoreVal = document.getElementById('overallScoreVal');
  const passRateSub = document.getElementById('passRateSub');
  const passedTotalVal = document.getElementById('passedTotalVal');
  const failedCountSub = document.getElementById('failedCountSub');
  const criticalFailuresVal = document.getElementById('criticalFailuresVal');
  const avgLatencyVal = document.getElementById('avgLatencyVal');
  const durationSub = document.getElementById('durationSub');

  const rateInjection = document.getElementById('rateInjection');
  const rateInstruction = document.getElementById('rateInstruction');
  const rateMemory = document.getElementById('rateMemory');
  const rateHallucination = document.getElementById('rateHallucination');
  const rateRag = document.getElementById('rateRag');

  const categoriesGrid = document.getElementById('categoriesGrid');
  const evalTableBody = document.getElementById('evalTableBody');
  const tableCountText = document.getElementById('tableCountText');

  const detailModal = document.getElementById('detailModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalTestId = document.getElementById('modalTestId');
  const modalUserInput = document.getElementById('modalUserInput');
  const modalExpected = document.getElementById('modalExpected');
  const modalActualOutput = document.getElementById('modalActualOutput');
  const modalReason = document.getElementById('modalReason');

  let currentReport = null;
  let activeFilter = 'all';

  // Load initial report
  fetchLatestReport();

  // Run suite button event
  runSuiteBtn.addEventListener('click', async () => {
    runSuiteBtn.disabled = true;
    runSuiteBtn.innerHTML = `<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg> Running 20 Benchmark Categories...`;

    try {
      const res = await fetch('/api/eval/run', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        currentReport = data.report;
        renderDashboard(currentReport);
      } else {
        alert(data.error || 'Failed to execute evaluation suite.');
      }
    } catch (err) {
      alert('Network error executing test suite.');
    } finally {
      runSuiteBtn.disabled = false;
      runSuiteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Benchmark Suite`;
    }
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      renderTable(currentReport?.results || []);
    });
  });

  // Modal Close
  closeModalBtn.addEventListener('click', () => {
    detailModal.classList.add('hidden');
  });

  async function fetchLatestReport() {
    try {
      const res = await fetch('/api/eval/latest');
      const data = await res.json();
      if (data.success && data.has_results) {
        currentReport = data.report;
        renderDashboard(currentReport);
      }
    } catch (err) {
      console.error('Failed to load evaluation metrics:', err);
    }
  }

  function renderDashboard(report) {
    if (!report || !report.summary) return;

    const s = report.summary;

    // Top Cards
    overallScoreVal.textContent = `${s.overall_score.toFixed(1)}%`;
    passRateSub.textContent = `Pass Rate: ${s.pass_rate.toFixed(1)}%`;
    passedTotalVal.textContent = `${s.passed_count} / ${s.total_tests}`;
    failedCountSub.textContent = `Failed: ${s.failed_count}`;
    criticalFailuresVal.textContent = `${s.critical_failures_count}`;
    avgLatencyVal.textContent = `${s.avg_latency_ms} ms`;
    durationSub.textContent = `Total Duration: ${(report.duration_ms / 1000).toFixed(1)}s`;

    // Safety Grid
    rateInjection.textContent = `${s.prompt_injection_resistance}%`;
    rateInstruction.textContent = `${s.instruction_following_rate}%`;
    rateMemory.textContent = `${s.memory_accuracy}%`;
    rateHallucination.textContent = `${s.hallucination_rate}%`;
    rateRag.textContent = `${s.rag_accuracy}%`;

    // Categories Breakdown
    categoriesGrid.innerHTML = '';
    const catScores = s.category_scores || {};
    Object.keys(catScores).forEach(catName => {
      const catData = catScores[catName];
      const card = document.createElement('div');
      card.className = 'cat-card';
      const cleanName = catName.replace(/_/g, ' ');

      card.innerHTML = `
        <div class="cat-card-header">
          <div class="cat-card-name">${cleanName}</div>
          <div class="cat-card-score">${catData.score}%</div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${catData.score}%"></div>
        </div>
      `;
      categoriesGrid.appendChild(card);
    });

    // Render Table
    renderTable(report.results || []);
  }

  function renderTable(results) {
    evalTableBody.innerHTML = '';

    let filtered = results;
    if (activeFilter === 'passed') filtered = results.filter(r => r.pass);
    if (activeFilter === 'failed') filtered = results.filter(r => !r.pass);
    if (activeFilter === 'critical') filtered = results.filter(r => r.severity === 'critical');

    tableCountText.textContent = `Showing ${filtered.length} of ${results.length} test cases`;

    if (filtered.length === 0) {
      evalTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--text-muted);">No test cases match filter.</td></tr>`;
      return;
    }

    filtered.forEach(r => {
      const tr = document.createElement('tr');

      const sevClass = r.severity === 'critical' ? 'badge-sev-critical' : (r.severity === 'high' ? 'badge-sev-high' : '');
      const statusBadge = r.pass ? `<span class="badge-pass">PASS</span>` : `<span class="badge-fail">FAIL</span>`;

      tr.innerHTML = `
        <td style="font-family:var(--font-code); font-weight:600;">${r.test_id}</td>
        <td><span style="font-size:0.8rem; text-transform:capitalize; background:var(--bg-app); padding:0.2rem 0.4rem; border-radius:4px;">${r.category.replace(/_/g, ' ')}</span></td>
        <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(r.user_input)}</td>
        <td><span class="${sevClass}">${r.severity.toUpperCase()}</span></td>
        <td>${statusBadge}</td>
        <td style="font-weight:700;">${r.score}</td>
        <td style="font-family:var(--font-code); font-size:0.8rem;">${r.latencyMs} ms</td>
        <td>
          <button class="view-btn" style="background:var(--bg-app); border:1px solid var(--border-color); color:var(--text-muted); padding:0.25rem 0.5rem; border-radius:4px; font-size:0.75rem; cursor:pointer;">Details</button>
        </td>
      `;

      tr.querySelector('.view-btn').addEventListener('click', () => {
        openModal(r);
      });

      evalTableBody.appendChild(tr);
    });
  }

  function openModal(testCase) {
    modalTestId.textContent = `[${testCase.test_id}] ${testCase.category.toUpperCase()} (${testCase.severity.toUpperCase()})`;
    modalUserInput.textContent = testCase.user_input;
    modalExpected.textContent = testCase.expected_behavior + (testCase.expected_answer ? `\n\nExpected: ${testCase.expected_answer}` : '');
    modalActualOutput.textContent = testCase.actual_output || '(Empty Output)';
    modalReason.textContent = testCase.evaluator_reason;

    detailModal.classList.remove('hidden');
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
});
