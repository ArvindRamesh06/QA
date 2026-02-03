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

// Dependency Elements
const viewApisBtn = document.getElementById('viewApisBtn');
const viewDepsBtn = document.getElementById('viewDepsBtn');
const apisView = document.getElementById('apisView');
const dependenciesView = document.getElementById('dependenciesView');
const dependenciesList = document.getElementById('dependenciesList');
const candidatesList = document.getElementById('candidatesList');

// API Details Elements
const apiMethodEndpoint = document.getElementById('apiMethodEndpoint');
const apiSummary = document.getElementById('apiSummary');
const apiDescription = document.getElementById('apiDescription');

const apiResponseSchema = document.getElementById('apiResponseSchema');
const apiVariablesList = document.getElementById('apiVariablesList');

let currentApiId = null;
let currentApi = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchProjects();
    setupIngestToggle();
});

// Event Listeners
createProjectForm.addEventListener('submit', (e) => {
    console.log('Interaction: Create Project form submitted');
    handleCreateProject(e);
});
backToProjectBtn.addEventListener('click', () => {
    console.log('Interaction: Back to Project button clicked');
    showProjectDetailView();
});
if (ingestForm) ingestForm.addEventListener('submit', (e) => {
    console.log('Interaction: Ingest form submitted');
    handleIngest(e);
});
if (analyzeBtn) analyzeBtn.addEventListener('click', () => {
    console.log('Interaction: Analyze API button clicked');
    handleAnalyze();
});
if (deleteProjectBtn) deleteProjectBtn.addEventListener('click', () => {
    console.log('Interaction: Delete Project button clicked');
    handleDeleteProject();
});

// Tab Navigation
viewApisBtn.addEventListener('click', () => {
    console.log('Interaction: Switched to APIs tab');
    switchTab('apis');
});
viewDepsBtn.addEventListener('click', () => {
    console.log('Interaction: Switched to Dependencies tab');
    switchTab('deps');
});

// Functions

function setupIngestToggle() {
    const radios = document.querySelectorAll('input[name="ingestType"]');
    const urlGroup = document.getElementById('ingestUrlGroup');
    const fileGroup = document.getElementById('ingestFileGroup');

    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            console.log(`Interaction: Ingest Type changed to ${e.target.value}`);
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
    console.log('Data: Fetching projects...');
    projectsList.innerHTML = '<div class="loading">Loading projects...</div>';
    try {
        const response = await fetch(`${API_BASE_URL}/projects`);
        if (!response.ok) throw new Error('Failed to fetch projects');
        projects = await response.json();
        console.log(`Data: Fetched ${projects.length} projects`);
        renderProjectsList();
    } catch (error) {
        console.error('Error fetching projects:', error);
        projectsList.innerHTML = `<div class="error">Error loading projects: ${error.message}</div>`;
    }
}

async function handleCreateProject(e) {
    e.preventDefault();
    const name = projectNameInput.value.trim();
    console.log(`Action: Creating project "${name}"`);
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
        console.log('Action: Project created successfully');
        projectNameInput.value = '';
        await fetchProjects();
    } catch (error) {
        console.error('Error creating project:', error);
        alert('Error creating project: ' + error.message);
    }
}

async function handleIngest(e) {
    e.preventDefault();
    console.log('Action: Handling Ingest...');
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
            console.log(`Action: Ingesting from URL: ${sourceUrl}`);

            response = await fetch(`${API_BASE_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: currentProjectId, sourceUrl })
            });
        } else {
            const file = ingestFileInput.files[0];
            if (!file) throw new Error('File is required');
            console.log(`Action: Ingesting file: ${file ? file.name : 'Unknown'}`);

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
        console.log('Action: Ingestion successful', result);
        alert(`Ingestion Successful! ${result.count} APIs added.`);
        ingestUrlInput.value = '';
        ingestFileInput.value = '';
        fetchProjectApis(currentProjectId);
    } catch (error) {
        console.error('Ingestion failed:', error);
        alert('Ingestion Error: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function handleDeleteProject() {
    console.log(`Action: Requesting delete for project ${currentProjectId}`);
    if (!currentProjectId || !confirm('Are you sure you want to delete this project?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/projects/${currentProjectId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete project');

        console.log('Action: Project deleted');
        alert('Project deleted successfully');
        projectDetail.classList.add('hidden');
        apiDetailView.classList.add('hidden');
        emptyState.classList.remove('hidden');
        currentProjectId = null;
        await fetchProjects();
    } catch (error) {
        console.error('Delete failed:', error);
        alert('Error deleting project: ' + error.message);
    }
}

async function handleAnalyze() {
    console.log(`Action: Analyzing API ${currentApiId} in Project ${currentProjectId}`);
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
        console.log('Action: Analysis complete', result);
        const count = result.candidates || 0;

        // precise user feedback
        analyzeBtn.textContent = `Success! Found ${count} candidates`;
        analyzeBtn.classList.add('btn-success'); // Assuming we might want to style it or just let it be

        // Short delay so user sees the success message
        setTimeout(() => {
            console.log('Action: Auto-switching to Dependencies tab');
            switchTab('deps');
            analyzeBtn.textContent = 'Analyze API';
            analyzeBtn.disabled = false;
        }, 1500);

    } catch (error) {
        console.error('Analysis failed:', error);
        alert('Analysis Error: ' + error.message);
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
        item.onclick = () => {
            console.log(`Interaction: Selected project "${project.name}" (${project.id})`);
            selectProject(project);
        };

        item.innerHTML = `
            <h4>${escapeHtml(project.name)}</h4>
            <p>${new Date(project.createdAt).toLocaleDateString()}</p>
        `;

        projectsList.appendChild(item);
    });
}

function selectProject(project) {
    console.log(`Action: Loading Details for Project ${project.id}`);
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
    console.log(`Data: Fetching APIs for project ${projectId}...`);
    apiList.innerHTML = '<div class="loading">Loading APIs...</div>';

    try {
        const response = await fetch(`${API_BASE_URL}/projects/${projectId}/apis`);
        // Note: The backend route implementation might be missing or different based on my specific quick look earlier.
        // I saw: router.get('/projects/:projectId/apis', ...) in routes.ts, so it should work.

        if (!response.ok) throw new Error('Failed to fetch APIs');
        const apis = await response.json();
        console.log(`Data: Fetched ${apis.length} APIs`);
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
        item.onclick = () => {
            console.log(`Interaction: Selected API "${api.method} ${api.path}"`);
            selectApi(api);
        };

        const methodClass = getMethodClass(api.method);

        item.innerHTML = `
            <h4><span style="color:${methodClass}">${api.method}</span> ${escapeHtml(api.path)}</h4>
            <p>${escapeHtml(api.summary || 'No summary')}</p>
        `;

        apiList.appendChild(item);
    });
}


function selectApi(api) {
    console.log(`Action: Viewing API Details for ${api.id}`);
    currentApiId = api.id;
    // currentApi = api; // Don't rely on the partial list object
    projectDetail.classList.add('hidden');
    apiDetailView.classList.remove('hidden');

    // Reset UI
    apiMethodEndpoint.innerHTML = 'Loading...';
    apiSummary.textContent = '';
    apiDescription.textContent = '';
    apiRequestSchema.textContent = '{}';
    apiResponseSchema.textContent = '{}';
    apiVariablesList.innerHTML = '<p>Loading details...</p>';

    // Clear previous analysis results
    analysisResult.classList.add('hidden');
    analysisContent.innerHTML = '';

    fetchApiDetails(api.id);
}

async function fetchApiDetails(apiId) {
    console.log(`Data: Fetching full details for API ${apiId}`);
    try {
        const res = await fetch(`${API_BASE_URL}/apis/${apiId}`);
        if (!res.ok) throw new Error("Failed to fetch API details");
        const api = await res.json();
        currentApi = api;
        console.log('Data: API details loaded', api);
        renderApiDetails(api);
    } catch (e) {
        apiMethodEndpoint.innerHTML = 'Error loading API';
        console.error(e);
    }
}

function renderApiDetails(api) {
    const methodHtml = `<span style="color:${getMethodClass(api.method)}">${api.method}</span>`;
    apiMethodEndpoint.innerHTML = `${methodHtml} ${escapeHtml(api.path)}`;
    apiSummary.textContent = api.summary || 'No summary provided';
    apiDescription.textContent = api.description || 'No description provided';

    apiRequestSchema.textContent = JSON.stringify(api.requestSchema || {}, null, 2);
    apiResponseSchema.textContent = JSON.stringify(api.responseSchema || {}, null, 2);

    renderVariablesTable(api.variables || []);
}

function renderVariablesTable(variables) {
    if (!variables || variables.length === 0) {
        apiVariablesList.innerHTML = '<p class="text-muted">No explicit variables found.</p>';
        return;
    }

    let html = `
        <table class="analysis-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Type</th>
                    <th>Data Type</th>
                    <th>Confidence</th>
                </tr>
            </thead>
            <tbody>
    `;

    variables.forEach(v => {
        let typeClass = 'badge constant';
        if (v.varType === 'user_input') typeClass = 'badge user_input';
        else if (v.varType === 'dependent_candidate') typeClass = 'badge dependent';

        html += `
            <tr>
                <td>${escapeHtml(v.name)}</td>
                <td><span class="badge" style="background:#f1f5f9">${v.location}</span></td>
                <td><span class="${typeClass}">${v.varType}</span></td>
                <td><span style="font-family:monospace; font-size:0.9em">${v.dataType}</span></td>
                <td>${v.aiConfidence ? (v.aiConfidence * 100).toFixed(0) + '%' : '-'}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    apiVariablesList.innerHTML = html;
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

// Dependency Management
function switchTab(tab) {
    console.log(`Action: Switch Tab -> ${tab}`);
    if (tab === 'apis') {
        viewApisBtn.classList.add('active');
        viewDepsBtn.classList.remove('active');
        apisView.classList.remove('hidden');
        dependenciesView.classList.add('hidden');
    } else {
        viewDepsBtn.classList.add('active');
        viewApisBtn.classList.remove('active');
        dependenciesView.classList.remove('hidden');
        apisView.classList.add('hidden');
        fetchDependencyData();
    }
}

async function fetchDependencyData() {
    console.log('Data: Fetching dependencies and candidates...');
    if (!currentProjectId) return;

    dependenciesList.innerHTML = '<p>Loading dependencies...</p>';
    candidatesList.innerHTML = '<p>Loading candidates...</p>';

    try {
        const [depsRes, candRes] = await Promise.all([
            fetch(`${API_BASE_URL}/projects/${currentProjectId}/dependencies`),
            fetch(`${API_BASE_URL}/projects/${currentProjectId}/candidates`)
        ]);

        const deps = await depsRes.json();
        const candidates = await candRes.json();
        console.log(`Data: Loaded ${deps.length} dependencies, ${candidates.length} candidates`);

        renderDependencies(deps);
        renderCandidates(candidates);
    } catch (error) {
        console.error("Failed to load dependency data", error);
        dependenciesList.innerHTML = '<p class="error">Failed to load dependencies.</p>';
        candidatesList.innerHTML = '<p class="error">Failed to load candidates.</p>';
    }
}

function renderDependencies(dependencies) {
    dependenciesList.innerHTML = '';

    if (dependencies.length === 0) {
        dependenciesList.innerHTML = '<p class="text-muted">No verified dependencies yet.</p>';
        return;
    }

    dependencies.forEach(dep => {
        const item = document.createElement('div');
        item.className = 'dependency-item';
        // Source -> Target
        item.innerHTML = `
            <div class="dep-source">
                <div class="dep-method" style="color:${getMethodClass(dep.sourceApi.method)}">${dep.sourceApi.method}</div>
                <div class="dep-path">${escapeHtml(dep.sourceApi.path)}</div>
            </div>
            <div class="dep-target">
                <div class="dep-method" style="color:${getMethodClass(dep.targetApi.method)}">${dep.targetApi.method}</div>
                <div class="dep-path">${escapeHtml(dep.targetApi.path)}</div>
                <div class="dep-mapping">Map: ${JSON.stringify(dep.mapping)}</div>
            </div>
            <div>
               <span class="badge dependent">Verified</span>
            </div>
            <div>
                <button class="btn-danger" onclick="deleteDependency('${dep.id}')">Delete</button>
            </div>
        `;
        dependenciesList.appendChild(item);
    });
}

function renderCandidates(candidates) {
    candidatesList.innerHTML = '';

    if (candidates.length === 0) {
        candidatesList.innerHTML = '<p class="text-muted">No AI suggestions found. Run "Analyze API" to find more.</p>';
        return;
    }

    candidates.forEach(cand => {
        const item = document.createElement('div');
        item.className = 'dependency-item';

        let confClass = 'confidence-low';
        if (cand.confidence > 0.8) confClass = 'confidence-high';
        else if (cand.confidence > 0.5) confClass = 'confidence-med';

        item.innerHTML = `
            <div class="dep-source">
                <div class="dep-method" style="color:${getMethodClass(cand.sourceApi.method)}">${cand.sourceApi.method}</div>
                <div class="dep-path">${escapeHtml(cand.sourceApi.path)}</div>
            </div>
            <div class="dep-target">
                <div class="dep-method" style="color:${getMethodClass(cand.targetApi.method)}">${cand.targetApi.method}</div>
                <div class="dep-path">${escapeHtml(cand.targetApi.path)}</div>
                <div class="dep-mapping">Map: ${JSON.stringify(cand.mapping)}</div>
            </div>
            <div>
               <span class="${confClass}">${(cand.confidence * 100).toFixed(0)}% Match</span>
            </div>
            <div>
                <button class="btn-success" onclick="acceptCandidate('${cand.id}')">Accept</button>
            </div>
        `;
        candidatesList.appendChild(item);
    });
}

// Global scope for onclick handlers
window.acceptCandidate = async (candidateId) => {
    console.log(`Interaction: Accepting candidate ${candidateId}`);
    // We need to find the candidate object to get details, or better, keep the Candidate ID and just call an endpoint?
    // The backend `createDependency` requires { sourceApiId, targetApiId, mapping }. 
    // But we are clicking "Accept" on a candidate. Ideally backend should have "promote candidate" endpoint.
    // For now, I'll fetch the candidates again to find the data or (hack) store it in DOM.
    // Let's assume we can pass the data via onclick or just find it in memory if we stored it? 
    // Simpler: Let's fetch the list again from memory? 
    // I'll make `candidates` a global variable or just re-fetch.
    // Actually, let's just use the candidate ID if I can... 
    // Wait, the backend `createDependency` takes raw data. It doesn't take candidateId. 
    // I should probably pass the data in the function call.

    // Changing strategy: renderCandidates will attach the data to the element or I will use a global map.
    // Let's use a global map for simplicity in this file.

    const candidate = window.currentCandidates.find(c => c.id === candidateId);
    if (!candidate) return;

    try {
        const payload = {
            sourceApiId: candidate.sourceApiId,
            targetApiId: candidate.targetApiId,
            mapping: candidate.mapping,
            isRequired: true
        };

        const res = await fetch(`${API_BASE_URL}/dependencies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Failed to create dependency");

        console.log('Action: Candidate accepted, dependency created');
        // Refresh
        fetchDependencyData();
    } catch (e) {
        console.error('Accept failed:', e);
        alert("Error accepting candidate: " + e.message);
    }
};

window.deleteDependency = async (depId) => {
    console.log(`Interaction: Deleting dependency ${depId}`);
    if (!confirm("Remove this dependency?")) return;
    try {
        const res = await fetch(`${API_BASE_URL}/dependencies/${depId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error("Failed to delete");
        console.log('Action: Dependency deleted');
        fetchDependencyData();
    } catch (e) {
        console.error('Delete failed:', e);
        alert("Error: " + e.message);
    }
};

// Hook into renderCandidates to store data
const originalRenderCandidates = renderCandidates;
window.currentCandidates = [];
renderCandidates = (candidates) => {
    window.currentCandidates = candidates;
    originalRenderCandidates(candidates);
}
