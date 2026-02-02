const API_BASE_URL = 'http://localhost:3000/api';

// State
let projects = [];
let currentProjectId = null;

// DOM Elements
const createProjectForm = document.getElementById('createProjectForm');
const projectNameInput = document.getElementById('projectName');
const projectsList = document.getElementById('projectsList');
const contentArea = document.getElementById('contentArea');
const projectDetail = document.getElementById('projectDetail');
const detailProjectName = document.getElementById('detailProjectName');
const detailProjectId = document.getElementById('detailProjectId');
const apiList = document.getElementById('apiList');
const emptyState = document.querySelector('.empty-state');
const apiDetailView = document.getElementById('apiDetailView');
const backToProjectBtn = document.getElementById('backToProject');
const ingestForm = document.getElementById('ingestForm');
const ingestUrlInput = document.getElementById('ingestUrl');
const ingestFileInput = document.getElementById('ingestFile');
const analyzeBtn = document.getElementById('analyzeBtn');
const analysisResult = document.getElementById('analysisResult');
const analysisContent = document.getElementById('analysisContent');
const deleteProjectBtn = document.getElementById('deleteProjectBtn');

// API Details Elements
const apiMethodEndpoint = document.getElementById('apiMethodEndpoint');
const apiSummary = document.getElementById('apiSummary');
const apiDescription = document.getElementById('apiDescription');
const apiRequestSchema = document.getElementById('apiRequestSchema');
const apiResponseSchema = document.getElementById('apiResponseSchema');

let currentApiId = null;
let currentApi = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchProjects();
    setupIngestToggle();
});

// Event Listeners
createProjectForm.addEventListener('submit', handleCreateProject);
backToProjectBtn.addEventListener('click', showProjectDetailView);
if (ingestForm) ingestForm.addEventListener('submit', handleIngest);
if (analyzeBtn) analyzeBtn.addEventListener('click', handleAnalyze);
if (deleteProjectBtn) deleteProjectBtn.addEventListener('click', handleDeleteProject);

// Functions

function setupIngestToggle() {
    const radios = document.querySelectorAll('input[name="ingestType"]');
    const urlGroup = document.getElementById('ingestUrlGroup');
    const fileGroup = document.getElementById('ingestFileGroup');

    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'url') {
                urlGroup.classList.remove('hidden');
                fileGroup.classList.add('hidden');
                ingestUrlInput.required = true;
                ingestFileInput.required = false;
            } else {
                urlGroup.classList.add('hidden');
                fileGroup.classList.remove('hidden');
                ingestUrlInput.required = false;
                ingestFileInput.required = true;
            }
        });
    });
}

async function fetchProjects() {
    projectsList.innerHTML = '<div class="loading">Loading projects...</div>';
    try {
        const response = await fetch(`${API_BASE_URL}/projects`);
        if (!response.ok) throw new Error('Failed to fetch projects');
        projects = await response.json();
        renderProjectsList();
    } catch (error) {
        console.error(error);
        projectsList.innerHTML = `<div class="error">Error loading projects: ${error.message}</div>`;
    }
}

async function handleCreateProject(e) {
    e.preventDefault();
    const name = projectNameInput.value.trim();
    if (!name) return;

    try {
        const response = await fetch(`${API_BASE_URL}/projects`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, userId: 'demo-user' }) // Hardcoded userId for demo as per schema req
        });

        if (!response.ok) throw new Error('Failed to create project');

        // Refresh list
        projectNameInput.value = '';
        await fetchProjects();
    } catch (error) {
        alert('Error creating project: ' + error.message);
    }
}

async function handleIngest(e) {
    e.preventDefault();
    if (!currentProjectId) return;

    const ingestType = document.querySelector('input[name="ingestType"]:checked').value;
    const btn = ingestForm.querySelector('button');
    const originalText = btn.textContent;
    btn.textContent = 'Ingesting...';
    btn.disabled = true;

    try {
        let response;
        if (ingestType === 'url') {
            const sourceUrl = ingestUrlInput.value.trim();
            if (!sourceUrl) throw new Error('URL is required');

            response = await fetch(`${API_BASE_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: currentProjectId, sourceUrl })
            });
        } else {
            const file = ingestFileInput.files[0];
            if (!file) throw new Error('File is required');

            const formData = new FormData();
            formData.append('projectId', currentProjectId);
            formData.append('file', file);

            response = await fetch(`${API_BASE_URL}/ingest`, {
                method: 'POST',
                body: formData
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ingestion failed');
        }

        const result = await response.json();
        alert(`Ingestion Successful! ${result.count} APIs added.`);
        ingestUrlInput.value = '';
        ingestFileInput.value = '';
        fetchProjectApis(currentProjectId);
    } catch (error) {
        alert('Ingestion Error: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function handleDeleteProject() {
    if (!currentProjectId || !confirm('Are you sure you want to delete this project?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/projects/${currentProjectId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete project');

        alert('Project deleted successfully');
        projectDetail.classList.add('hidden');
        apiDetailView.classList.add('hidden');
        emptyState.classList.remove('hidden');
        currentProjectId = null;
        await fetchProjects();
    } catch (error) {
        alert('Error deleting project: ' + error.message);
    }
}

async function handleAnalyze() {
    if (!currentApiId) return;

    analyzeBtn.textContent = 'Analyzing...';
    analyzeBtn.disabled = true;
    analysisResult.classList.add('hidden');
    analysisContent.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE_URL}/projects/${currentProjectId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiId: currentApiId })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Analysis failed');
        }

        const result = await response.json();
        displayAnalysisResult(result);
    } catch (error) {
        alert('Analysis Error: ' + error.message);
    } finally {
        analyzeBtn.textContent = 'Analyze API';
        analyzeBtn.disabled = false;
    }
}

function displayAnalysisResult(result) {
    // analysisResult.innerHTML = ''; // Clear container to rebuild structure if needed, or just append properly.
    // Actually analysisResult is a container. Let's make sure it has a header and close button.

    // Better way: Reconstruct the inner HTML of the result card entirely
    let contentHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:10px;">
            <h3 style="margin:0;">Analysis Results</h3>
            <button id="closeAnalysisBtn" style="background:none; border:none; font-size:1.2rem; cursor:pointer;" title="Close">×</button>
        </div>
    `;

    const analysisData = result.analysis || [];

    // Note: Analysis Service now returns results scoped to the Target API (or all content context).
    // The new schema doesn't necessarily include apiEndpoint/apiMethod in the result object for every row.
    // We assume the results returned correspond to the requested API(s).
    // If multiple APIs were analyzed, this might be ambiguous, but for single API analysis (currentApiId), it's fine.

    const filteredData = analysisData; // No filtering needed if backend handles scope

    if (filteredData.length > 0) {
        contentHtml += `
            <table class="analysis-table">
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Classification</th>
                        <th>Source (Dependency)</th>
                        <th>Confidence</th>
                        <th>Reason</th>
                    </tr>
                </thead>
                <tbody>
        `;

        filteredData.forEach(v => {
            // Map new schema to display labels
            const struct = v.structuralType ? v.structuralType.charAt(0).toUpperCase() + v.structuralType.slice(1) : 'Unknown';
            const dep = v.dependencyType ? v.dependencyType.charAt(0).toUpperCase() + v.dependencyType.slice(1) : 'Unknown';

            const typeLabel = `${struct} · ${dep}`;

            let badgeClass = 'constant';

            if (v.structuralType === 'variable') {
                if (v.dependencyType === 'dependent') {
                    badgeClass = 'dependent';
                } else {
                    badgeClass = 'user_input';
                }
            } else {
                if (v.dependencyType === 'dependent') {
                    badgeClass = 'dependent_constant';
                } else {
                    badgeClass = 'constant';
                }
            }

            const sourceInfo = (v.source)
                ? `${v.source} <span class="badge" style="font-size:0.6em; background:#e0e7ff; color:#3730a3;">${v.origin || 'inferred'}</span>`
                : '<span class="text-muted">-</span>';

            contentHtml += `
                <tr>
                    <td><strong>${v.variable}</strong></td>
                    <td>
                        <span class="badge ${badgeClass}">${typeLabel}</span>
                    </td>
                    <td>${sourceInfo}</td>
                    <td>
                        <div style="display:flex; flex-direction:column;">
                            <span>${v.confidence !== undefined ? v.confidence : 'N/A'}</span>
                        </div>
                    </td>
                     <td><small class="text-muted" style="font-size:0.8em;">${v.reason || '-'}</small></td>
                </tr>`;
        });
        contentHtml += '</tbody></table>';
    } else {
        contentHtml += '<div style="padding: 10px; color: #64748b;">No variables identified for this API.</div>';
    }

    analysisResult.innerHTML = contentHtml;
    analysisResult.classList.remove('hidden');

    // Add listener to the new close button
    document.getElementById('closeAnalysisBtn').addEventListener('click', () => {
        analysisResult.classList.add('hidden');
    });
}


function renderProjectsList() {
    projectsList.innerHTML = '';

    if (projects.length === 0) {
        projectsList.innerHTML = '<div class="text-muted" style="padding:10px; text-align:center">No projects yet. Create one!</div>';
        return;
    }

    projects.forEach(project => {
        const item = document.createElement('div');
        item.className = `list-item ${currentProjectId === project.id ? 'active' : ''}`;
        item.onclick = () => selectProject(project);

        item.innerHTML = `
            <h4>${escapeHtml(project.name)}</h4>
            <p>${new Date(project.createdAt).toLocaleDateString()}</p>
        `;

        projectsList.appendChild(item);
    });
}

function selectProject(project) {
    currentProjectId = project.id;
    renderProjectsList(); // Re-render to update active state

    // Update UI
    emptyState.classList.add('hidden');
    apiDetailView.classList.add('hidden');
    projectDetail.classList.remove('hidden');

    detailProjectName.textContent = project.name;
    detailProjectId.textContent = `ID: ${project.id}`;

    fetchProjectApis(project.id);
}

async function fetchProjectApis(projectId) {
    apiList.innerHTML = '<div class="loading">Loading APIs...</div>';

    try {
        const response = await fetch(`${API_BASE_URL}/projects/${projectId}/apis`);
        // Note: The backend route implementation might be missing or different based on my specific quick look earlier.
        // I saw: router.get('/projects/:projectId/apis', ...) in routes.ts, so it should work.

        if (!response.ok) throw new Error('Failed to fetch APIs');
        const apis = await response.json();
        renderApiList(apis);
    } catch (error) {
        console.error(error);
        apiList.innerHTML = `<div class="error">Error loading APIs: ${error.message}</div>`;
    }
}

function renderApiList(apis) {
    apiList.innerHTML = '';

    if (!apis || apis.length === 0) {
        apiList.innerHTML = '<p class="text-muted">No APIs found for this project. Try ingesting some!</p>';
        return;
    }

    apis.forEach(api => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.onclick = () => selectApi(api);

        const methodClass = getMethodClass(api.method);

        item.innerHTML = `
            <h4><span style="color:${methodClass}">${api.method}</span> ${escapeHtml(api.endpoint)}</h4>
            <p>${escapeHtml(api.summary || 'No summary')}</p>
        `;

        apiList.appendChild(item);
    });
}


function selectApi(api) {
    currentApiId = api.id;
    currentApi = api;
    projectDetail.classList.add('hidden');
    apiDetailView.classList.remove('hidden');

    const methodHtml = `<span style="color:${getMethodClass(api.method)}">${api.method}</span>`;
    apiMethodEndpoint.innerHTML = `${methodHtml} ${escapeHtml(api.endpoint)}`;
    apiSummary.textContent = api.summary || 'No summary provided';
    apiDescription.textContent = api.description || 'No description provided';

    apiRequestSchema.textContent = JSON.stringify(api.requestSchema || {}, null, 2);
    apiResponseSchema.textContent = JSON.stringify(api.responseSchema || {}, null, 2);

    // Clear previous analysis results
    analysisResult.classList.add('hidden');
    analysisContent.innerHTML = '';
}

function showProjectDetailView() {
    apiDetailView.classList.add('hidden');
    projectDetail.classList.remove('hidden');
}

// Utilities
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getMethodClass(method) {
    const m = method.toUpperCase();
    if (m === 'GET') return '#2563eb'; // Blue
    if (m === 'POST') return '#16a34a'; // Green
    if (m === 'PUT') return '#d97706'; // Orange
    if (m === 'DELETE') return '#dc2626'; // Red
    return '#4b5563'; // Gray
}

function getTypeDescription(type) {
    if (type === 'dependent') return 'These variables cannot be invented by the client — they must come from previous API responses.';
    if (type === 'dependent_constant') return 'Constant value that depends on system state.';
    if (type === 'user_input') return 'Provided by the user.';
    if (type === 'constant') return 'Static value.';
    return '';
}
