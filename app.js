// ==========================================
// PIZZACONTROL - SISTEMA COMPLETO
// ==========================================

// Auth check - redirect to login if not logged in
(function checkAuth() {
    const session = localStorage.getItem('pizzaControlSession');
    if (!session) { window.location.href = 'index.html'; return; }
    try {
        const s = JSON.parse(session);
        if (!s.logged) { window.location.href = 'index.html'; return; }
    } catch (e) { window.location.href = 'index.html'; return; }
})();

function fazerLogout() {
    if (confirm('Deseja realmente sair?')) {
        localStorage.removeItem('pizzaControlSession');
        window.location.href = 'index.html';
    }
}

function alterarSenha() {
    const user = document.getElementById('novoUser').value.trim();
    const senha = document.getElementById('novaSenha').value;
    const conf = document.getElementById('confSenha').value;
    if (!user || !senha) { alert('⚠️ Preencha usuário e senha!'); return; }
    if (senha !== conf) { alert('⚠️ As senhas não conferem!'); return; }
    if (senha.length < 4) { alert('⚠️ A senha deve ter no mínimo 4 caracteres!'); return; }
    localStorage.setItem('pizzaControlCredentials', JSON.stringify({ user: user, pass: senha }));
    document.getElementById('novoUser').value = '';
    document.getElementById('novaSenha').value = '';
    document.getElementById('confSenha').value = '';
    alert('✅ Credenciais alteradas com sucesso!\nNovo usuário: ' + user);
}

function gerarId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

let DB = {
    insumos: [], fichas: [], salgados: [],
    custos: { aluguel: 0, energia: 0, gas: 0, agua: 0, internet: 0, func: 0, gasolina: 0, emb: 0, mkt: 0, contador: 0, outros: 0, pizzas: 300, salgadosMes: 500 },
    massa: { ingredientes: [], pesoTotal: 3000, pesoP: 200, pesoM: 300, pesoG: 400, pesoGG: 500 }
};
let editandoFichaId = null;
let editandoSalgadoId = null;
let filtroTam = 'all';

document.addEventListener('DOMContentLoaded', () => {
    carregarDados(); setupNav(); renderAll(); loadMassaUI(); loadCustosUI(); addIngFicha(); addIngSalgado();
});

function setupNav() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('page-' + tab.dataset.page).classList.add('active');
            if (tab.dataset.page === 'nova-ficha') refreshIngSelects();
            if (tab.dataset.page === 'massa') { refreshMassaSelects(); calcMassa(); }
            if (tab.dataset.page === 'precificar') loadFichasSelect();
            if (tab.dataset.page === 'fichas') renderFichas();
            if (tab.dataset.page === 'dashboard') renderDashboard();
            if (tab.dataset.page === 'novo-salgado') refreshIngSalgadoSelects();
            if (tab.dataset.page === 'salgados') renderSalgados();
        });
    });
}

function salvarDados() {
    try { localStorage.setItem('pizzaControlFinal', JSON.stringify(DB)); status('💾 Salvo!'); renderAll(); }
    catch (e) { status('❌ Erro ao salvar!', true); }
}

function carregarDados() {
    let saved = localStorage.getItem('pizzaControlFinal');
    if (!saved) {
        const oldKeys = ['pizzaControlDados', 'pizzaControlV3', 'pizzaControlV2', 'pizzaControl'];
        for (let key of oldKeys) { if (localStorage.getItem(key)) { saved = localStorage.getItem(key); break; } }
    }
    if (saved) {
        try {
            const d = JSON.parse(saved);
            DB.insumos = Array.isArray(d.insumos) ? d.insumos : [];
            DB.fichas = Array.isArray(d.fichas) ? d.fichas : [];
            DB.insumos.forEach(i => { if (typeof i.id === 'number') i.id = i.id.toString(); });
            DB.fichas.forEach(f => { if (typeof f.id === 'number') f.id = f.id.toString(); });
            if (d.custos || d.custosFixos) {
                const c = d.custos || d.custosFixos;
                DB.custos = { aluguel: c.aluguel || 0, energia: c.energia || 0, gas: c.gas || 0, agua: c.agua || 0, internet: c.internet || 0, func: c.func || c.funcionarios || 0, gasolina: c.gasolina || 0, emb: c.emb || c.embalagens || 0, mkt: c.mkt || c.marketing || 0, contador: c.contador || 0, outros: c.outros || 0, pizzas: c.pizzas || c.pizzasMes || 300, salgadosMes: c.salgadosMes || 500 };
            }
            if (d.massa) {
                DB.massa = { ingredientes: d.massa.ingredientes || [], pesoTotal: d.massa.pesoTotal || d.massa.rendimento * 300 || 3000, pesoP: d.massa.pesoP || 200, pesoM: d.massa.pesoM || 300, pesoG: d.massa.pesoG || 400, pesoGG: d.massa.pesoGG || 500 };
            }
            DB.salgados = Array.isArray(d.salgados) ? d.salgados : [];
            DB.salgados.forEach(s => { if (typeof s.id === 'number') s.id = s.id.toString(); });
        } catch (e) { console.error('Erro ao carregar:', e); }
    }
}

function status(msg, error = false) {
    const bar = document.getElementById('statusBar');
    bar.textContent = msg;
    bar.className = 'status-bar show' + (error ? ' error' : '');
    setTimeout(() => bar.classList.remove('show'), 2500);
}

function testarStorage() {
    try {
        localStorage.setItem('_test', '1'); localStorage.removeItem('_test');
        status('✅ Storage OK! ' + DB.insumos.length + ' insumos, ' + DB.fichas.length + ' fichas');
    } catch (e) { status('❌ Storage não funciona!', true); }
}

function renderAll() { renderHeader(); renderInsumos(); renderFichas(); renderSalgados(); renderDashboard(); }

function renderHeader() {
    document.getElementById('hdrInsumos').textContent = DB.insumos.length;
    document.getElementById('hdrFichas').textContent = DB.fichas.length;
    document.getElementById('hdrSalgados').textContent = DB.salgados.length;
    document.getElementById('hdrCustoFixo').textContent = 'R$ ' + getCustoFixo().toFixed(2);
}

// ===== INSUMOS =====
function abrirModalInsumo(id = null) {
    document.getElementById('modalIns').classList.add('show');
    document.getElementById('insId').value = '';
    document.getElementById('insNome').value = '';
    document.getElementById('insQtd').value = '';
    document.getElementById('insPreco').value = '';
    document.getElementById('modalInsTitle').textContent = '📦 Novo Insumo';
    if (id) {
        const ins = DB.insumos.find(i => i.id === id);
        if (ins) {
            document.getElementById('insId').value = id;
            document.getElementById('insNome').value = ins.nome;
            document.getElementById('insCat').value = ins.categoria;
            document.getElementById('insUn').value = ins.unidade;
            document.getElementById('insQtd').value = ins.qtdEmb;
            document.getElementById('insPreco').value = ins.precoEmb;
            document.getElementById('modalInsTitle').textContent = '✏️ Editar Insumo';
        }
    }
}

function fecharModal(id) { document.getElementById(id).classList.remove('show'); }

function salvarInsumo() {
    const nome = document.getElementById('insNome').value.trim();
    const cat = document.getElementById('insCat').value;
    const un = document.getElementById('insUn').value;
    const qtd = parseFloat(document.getElementById('insQtd').value) || 0;
    const preco = parseFloat(document.getElementById('insPreco').value) || 0;
    const editId = document.getElementById('insId').value;
    if (!nome || !qtd || !preco) { alert('⚠️ Preencha todos os campos!'); return; }
    const custoUn = preco / qtd;
    if (editId) {
        const idx = DB.insumos.findIndex(i => i.id == editId);
        if (idx >= 0) DB.insumos[idx] = { ...DB.insumos[idx], nome, categoria: cat, unidade: un, qtdEmb: qtd, precoEmb: preco, custoUn };
    } else {
        DB.insumos.push({ id: gerarId(), nome, categoria: cat, unidade: un, qtdEmb: qtd, precoEmb: preco, custoUn });
    }
    salvarDados(); fecharModal('modalIns'); renderInsumos();
}

function excluirInsumo(id) {
    if (confirm('Excluir insumo?')) { DB.insumos = DB.insumos.filter(i => i.id !== id); salvarDados(); renderInsumos(); }
}

function renderInsumos() {
    const tbody = document.getElementById('tblInsumos');
    if (DB.insumos.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty"><div class="icon">📦</div>Nenhum insumo</td></tr>'; return; }
    tbody.innerHTML = DB.insumos.map(i => `<tr><td><strong>${i.nome}</strong></td><td><span class="badge badge-info">${i.categoria}</span></td><td>${i.unidade}</td><td>${i.qtdEmb}</td><td>R$ ${(i.precoEmb || 0).toFixed(2)}</td><td><strong style="color:var(--primary)">R$ ${(i.custoUn || 0).toFixed(4)}</strong></td><td class="actions"><button class="btn btn-info btn-sm" onclick="abrirModalInsumo('${i.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="excluirInsumo('${i.id}')">🗑️</button></td></tr>`).join('');
}

function filtrarInsumos() {
    const busca = document.getElementById('buscaIns').value.toLowerCase();
    document.querySelectorAll('#tblInsumos tr').forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(busca) ? '' : 'none'; });
}

document.getElementById('insQtd')?.addEventListener('input', previewInsumo);
document.getElementById('insPreco')?.addEventListener('input', previewInsumo);
function previewInsumo() {
    const qtd = parseFloat(document.getElementById('insQtd').value) || 0;
    const preco = parseFloat(document.getElementById('insPreco').value) || 0;
    const un = document.getElementById('insUn').value;
    document.getElementById('insPreview').innerHTML = (qtd > 0 && preco > 0)
        ? '💡 Custo: <strong>R$ ' + (preco / qtd).toFixed(4) + '</strong>/' + un : '💡 Preencha para ver';
}

// ===== CUSTOS FIXOS =====
function loadCustosUI() {
    const c = DB.custos;
    document.getElementById('cfAluguel').value = c.aluguel || '';
    document.getElementById('cfEnergia').value = c.energia || '';
    document.getElementById('cfGas').value = c.gas || '';
    document.getElementById('cfAgua').value = c.agua || '';
    document.getElementById('cfInternet').value = c.internet || '';
    document.getElementById('cfFunc').value = c.func || '';
    document.getElementById('cfGasolina').value = c.gasolina || '';
    document.getElementById('cfEmb').value = c.emb || '';
    document.getElementById('cfMkt').value = c.mkt || '';
    document.getElementById('cfContador').value = c.contador || '';
    document.getElementById('cfOutros').value = c.outros || '';
    document.getElementById('cfPizzas').value = c.pizzas || 300;
    document.getElementById('cfSalgados').value = c.salgadosMes || 500;
    calcCustos();
}

function calcCustos() {
    const vals = { aluguel: parseFloat(document.getElementById('cfAluguel').value) || 0, energia: parseFloat(document.getElementById('cfEnergia').value) || 0, gas: parseFloat(document.getElementById('cfGas').value) || 0, agua: parseFloat(document.getElementById('cfAgua').value) || 0, internet: parseFloat(document.getElementById('cfInternet').value) || 0, func: parseFloat(document.getElementById('cfFunc').value) || 0, gasolina: parseFloat(document.getElementById('cfGasolina').value) || 0, emb: parseFloat(document.getElementById('cfEmb').value) || 0, mkt: parseFloat(document.getElementById('cfMkt').value) || 0, contador: parseFloat(document.getElementById('cfContador').value) || 0, outros: parseFloat(document.getElementById('cfOutros').value) || 0 };
    const total = Object.values(vals).reduce((a, b) => a + b, 0);
    const pizzas = parseFloat(document.getElementById('cfPizzas').value) || 1;
    const salgados = parseFloat(document.getElementById('cfSalgados').value) || 1;
    document.getElementById('cfTotal').textContent = 'R$ ' + total.toFixed(2);
    document.getElementById('cfPorPizza').textContent = 'R$ ' + (total / pizzas).toFixed(2);
    document.getElementById('cfPorSalgado').textContent = 'R$ ' + (total / salgados).toFixed(2);
}

function salvarCustos() {
    DB.custos = { aluguel: parseFloat(document.getElementById('cfAluguel').value) || 0, energia: parseFloat(document.getElementById('cfEnergia').value) || 0, gas: parseFloat(document.getElementById('cfGas').value) || 0, agua: parseFloat(document.getElementById('cfAgua').value) || 0, internet: parseFloat(document.getElementById('cfInternet').value) || 0, func: parseFloat(document.getElementById('cfFunc').value) || 0, gasolina: parseFloat(document.getElementById('cfGasolina').value) || 0, emb: parseFloat(document.getElementById('cfEmb').value) || 0, mkt: parseFloat(document.getElementById('cfMkt').value) || 0, contador: parseFloat(document.getElementById('cfContador').value) || 0, outros: parseFloat(document.getElementById('cfOutros').value) || 0, pizzas: parseFloat(document.getElementById('cfPizzas').value) || 300, salgadosMes: parseFloat(document.getElementById('cfSalgados').value) || 500 };
    salvarDados(); alert('✅ Custos salvos!');
}

function getCustoFixo() {
    const c = DB.custos;
    const total = (c.aluguel || 0) + (c.energia || 0) + (c.gas || 0) + (c.agua || 0) + (c.internet || 0) + (c.func || 0) + (c.gasolina || 0) + (c.emb || 0) + (c.mkt || 0) + (c.contador || 0) + (c.outros || 0);
    return total / (c.pizzas || 1);
}

// ===== MASSA =====
function loadMassaUI() {
    const m = DB.massa;
    document.getElementById('massaPesoTotal').value = m.pesoTotal || 3000;
    document.getElementById('pesoP').value = m.pesoP || 200;
    document.getElementById('pesoM').value = m.pesoM || 300;
    document.getElementById('pesoG').value = m.pesoG || 400;
    document.getElementById('pesoGG').value = m.pesoGG || 500;
    document.getElementById('massaIngLista').innerHTML = '';
    if (m.ingredientes && m.ingredientes.length > 0) { m.ingredientes.forEach(ing => addIngMassa(ing.insumoId, ing.quantidade)); }
    else { addIngMassa(); }
    setTimeout(calcMassa, 100);
}

function refreshMassaSelects() {
    document.querySelectorAll('#massaIngLista select').forEach(sel => {
        const val = sel.value;
        sel.innerHTML = '<option value="">Selecione...</option>' + DB.insumos.map(i => `<option value="${i.id}">${i.nome}</option>`).join('');
        sel.value = val;
    });
}

function addIngMassa(insId = null, qtd = null) {
    const lista = document.getElementById('massaIngLista');
    const div = document.createElement('div'); div.className = 'massa-item';
    div.innerHTML = `<select class="form-control" onchange="calcMassa()"><option value="">Selecione...</option>${DB.insumos.map(i => `<option value="${i.id}" ${insId == i.id ? 'selected' : ''}>${i.nome}</option>`).join('')}</select><input type="number" class="form-control" placeholder="Qtd (g)" value="${qtd || ''}" oninput="calcMassa()"><span class="custo">R$ 0</span><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcMassa()">✕</button>`;
    lista.appendChild(div);
    if (qtd) setTimeout(calcMassa, 50);
}

function calcMassa() {
    let custoTotal = 0;
    document.querySelectorAll('#massaIngLista .massa-item').forEach(item => {
        const sel = item.querySelector('select'); const inp = item.querySelector('input'); const span = item.querySelector('.custo');
        const id = sel.value; const qtd = parseFloat(inp.value) || 0;
        if (id && qtd > 0) { const ins = DB.insumos.find(i => i.id == id); if (ins) { const custo = (ins.custoUn || 0) * qtd; custoTotal += custo; span.textContent = 'R$ ' + custo.toFixed(2); } }
        else { span.textContent = 'R$ 0'; }
    });
    const pesoTotal = parseFloat(document.getElementById('massaPesoTotal').value) || 1;
    const cpg = custoTotal / pesoTotal;
    const pesoP = parseFloat(document.getElementById('pesoP').value) || 0;
    const pesoM = parseFloat(document.getElementById('pesoM').value) || 0;
    const pesoG = parseFloat(document.getElementById('pesoG').value) || 0;
    const pesoGG = parseFloat(document.getElementById('pesoGG').value) || 0;
    document.getElementById('massaCustoTotal').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('massaPesoTotalRes').textContent = pesoTotal + ' g';
    document.getElementById('massaCustoGrama').textContent = 'R$ ' + cpg.toFixed(4);
    document.getElementById('massaCustoP').textContent = 'R$ ' + (cpg * pesoP).toFixed(2);
    document.getElementById('massaCustoM').textContent = 'R$ ' + (cpg * pesoM).toFixed(2);
    document.getElementById('massaCustoG').textContent = 'R$ ' + (cpg * pesoG).toFixed(2);
    document.getElementById('massaCustoGG').textContent = 'R$ ' + (cpg * pesoGG).toFixed(2);
    document.getElementById('massaInfoP').textContent = pesoP + 'g × R$' + cpg.toFixed(4);
    document.getElementById('massaInfoM').textContent = pesoM + 'g × R$' + cpg.toFixed(4);
    document.getElementById('massaInfoG').textContent = pesoG + 'g × R$' + cpg.toFixed(4);
    document.getElementById('massaInfoGG').textContent = pesoGG + 'g × R$' + cpg.toFixed(4);
}

function salvarMassa() {
    const ingredientes = [];
    document.querySelectorAll('#massaIngLista .massa-item').forEach(item => {
        const id = item.querySelector('select').value; const qtd = parseFloat(item.querySelector('input').value) || 0;
        if (id && qtd > 0) ingredientes.push({ insumoId: id, quantidade: qtd });
    });
    DB.massa = { ingredientes, pesoTotal: parseFloat(document.getElementById('massaPesoTotal').value) || 3000, pesoP: parseFloat(document.getElementById('pesoP').value) || 200, pesoM: parseFloat(document.getElementById('pesoM').value) || 300, pesoG: parseFloat(document.getElementById('pesoG').value) || 400, pesoGG: parseFloat(document.getElementById('pesoGG').value) || 500 };
    salvarDados(); alert('✅ Massa salva!');
}

function getCustoMassa(tamanho) {
    const m = DB.massa;
    if (!m.ingredientes || m.ingredientes.length === 0) return 0;
    let custoTotal = 0;
    m.ingredientes.forEach(ing => { const ins = DB.insumos.find(i => i.id == ing.insumoId); if (ins) custoTotal += (ins.custoUn || 0) * ing.quantidade; });
    const cpg = custoTotal / (m.pesoTotal || 3000);
    const pesos = { P: m.pesoP || 200, M: m.pesoM || 300, G: m.pesoG || 400, GG: m.pesoGG || 500 };
    return cpg * (pesos[tamanho] || 0);
}

// ===== FICHAS =====
function refreshIngSelects() {
    document.querySelectorAll('#ficIngLista select').forEach(sel => {
        const val = sel.value;
        sel.innerHTML = '<option value="">Selecione...</option>' + DB.insumos.map(i => `<option value="${i.id}">${i.nome} (R$${(i.custoUn || 0).toFixed(4)}/${i.unidade})</option>`).join('');
        sel.value = val;
    });
}

function addIngFicha(insId = null, qtd = null) {
    const lista = document.getElementById('ficIngLista');
    const div = document.createElement('div'); div.className = 'ingrediente-item';
    div.innerHTML = `<select class="form-control" onchange="calcFicha()"><option value="">Selecione...</option>${DB.insumos.map(i => `<option value="${i.id}" ${insId == i.id ? 'selected' : ''}>${i.nome} (R$${(i.custoUn || 0).toFixed(4)}/${i.unidade})</option>`).join('')}</select><input type="number" class="form-control" placeholder="Qtd" value="${qtd || ''}" oninput="calcFicha()"><span class="custo">R$ 0</span><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcFicha()">✕</button>`;
    lista.appendChild(div);
    if (qtd) setTimeout(calcFicha, 50);
}

function calcFicha() {
    let custoIng = 0;
    document.querySelectorAll('#ficIngLista .ingrediente-item').forEach(item => {
        const sel = item.querySelector('select'); const inp = item.querySelector('input'); const span = item.querySelector('.custo');
        const id = sel.value; const qtd = parseFloat(inp.value) || 0;
        if (id && qtd > 0) { const ins = DB.insumos.find(i => i.id == id); if (ins) { const custo = (ins.custoUn || 0) * qtd; custoIng += custo; span.textContent = 'R$ ' + custo.toFixed(2); } }
        else { span.textContent = 'R$ 0'; }
    });
    const tam = document.getElementById('ficTam').value;
    const incMassa = document.getElementById('ficMassa').value === '1';
    const custoMassa = incMassa ? getCustoMassa(tam) : 0;
    const custoFixo = getCustoFixo();
    const custoTotal = custoIng + custoMassa + custoFixo;
    const venda = parseFloat(document.getElementById('ficPreco').value) || 0;
    const lucro = venda - custoTotal;
    const cmv = venda > 0 ? (custoTotal / venda) * 100 : 0;
    const margem = venda > 0 ? (lucro / venda) * 100 : 0;
    document.getElementById('resIng').textContent = 'R$ ' + custoIng.toFixed(2);
    document.getElementById('resMassa').textContent = 'R$ ' + custoMassa.toFixed(2);
    document.getElementById('resCF').textContent = 'R$ ' + custoFixo.toFixed(2);
    document.getElementById('resTotal').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('resVenda').textContent = 'R$ ' + venda.toFixed(2);
    document.getElementById('resLucro').textContent = 'R$ ' + lucro.toFixed(2);
    document.getElementById('resLucro').className = 'val ' + (lucro >= 0 ? 'green' : 'red');
    document.getElementById('resCMV').textContent = cmv.toFixed(1) + '%';
    document.getElementById('resMargem').textContent = margem.toFixed(1) + '%';
    const bar = document.getElementById('cmvBar');
    bar.style.width = Math.min(cmv, 100) + '%';
    bar.className = 'cmv-fill ' + (cmv <= 30 ? 'good' : cmv <= 35 ? 'medium' : 'bad');
}

function salvarFicha() {
    const nome = document.getElementById('ficNome').value.trim();
    const cat = document.getElementById('ficCat').value;
    const tam = document.getElementById('ficTam').value;
    const preco = parseFloat(document.getElementById('ficPreco').value) || 0;
    const incMassa = document.getElementById('ficMassa').value === '1';
    if (!nome || preco <= 0) { alert('⚠️ Preencha nome e preço!'); return; }
    const ingredientes = []; let custoIng = 0;
    document.querySelectorAll('#ficIngLista .ingrediente-item').forEach(item => {
        const id = item.querySelector('select').value; const qtd = parseFloat(item.querySelector('input').value) || 0;
        if (id && qtd > 0) { const ins = DB.insumos.find(i => i.id == id); if (ins) { const custo = (ins.custoUn || 0) * qtd; custoIng += custo; ingredientes.push({ insumoId: id, nome: ins.nome, quantidade: qtd, unidade: ins.unidade, custo }); } }
    });
    if (ingredientes.length === 0) { alert('⚠️ Adicione ingredientes!'); return; }
    const custoMassa = incMassa ? getCustoMassa(tam) : 0;
    const custoFixo = getCustoFixo();
    const custoTotal = custoIng + custoMassa + custoFixo;
    const ficha = { nome, categoria: cat, tamanho: tam, precoVenda: preco, incMassa, ingredientes, custoIng, custoMassa, custoFixo, custoTotal, lucro: preco - custoTotal, cmv: (custoTotal / preco) * 100 };
    if (editandoFichaId) {
        const idx = DB.fichas.findIndex(f => f.id === editandoFichaId);
        if (idx >= 0) DB.fichas[idx] = { ...DB.fichas[idx], ...ficha };
        editandoFichaId = null;
    } else { ficha.id = gerarId(); DB.fichas.push(ficha); }
    salvarDados(); limparFicha();
    filtroTam = 'all';
    document.querySelectorAll('.size-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('.size-tab.all'); if (allTab) allTab.classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="fichas"]').classList.add('active');
    document.getElementById('page-fichas').classList.add('active');
    renderFichas();
}

function limparFicha() {
    editandoFichaId = null;
    document.getElementById('ficNome').value = '';
    document.getElementById('ficPreco').value = '';
    document.getElementById('ficIngLista').innerHTML = '';
    document.getElementById('fichaHeader').textContent = '➕ Nova Ficha Técnica';
    document.getElementById('fichaHeader').style.background = '';
    document.getElementById('ficCat').value = 'Tradicional';
    document.getElementById('ficTam').value = 'G';
    document.getElementById('ficMassa').value = '1';
    addIngFicha(); calcFicha();
}

function editarFicha(id) {
    const f = DB.fichas.find(x => x.id === id); if (!f) return;
    editandoFichaId = id;
    document.getElementById('ficNome').value = f.nome;
    document.getElementById('ficCat').value = f.categoria;
    document.getElementById('ficTam').value = f.tamanho;
    document.getElementById('ficPreco').value = f.precoVenda;
    document.getElementById('ficMassa').value = f.incMassa !== false ? '1' : '0';
    document.getElementById('ficIngLista').innerHTML = '';
    (f.ingredientes || []).forEach(ing => addIngFicha(ing.insumoId, ing.quantidade));
    calcFicha();
    document.getElementById('fichaHeader').textContent = '✏️ Editando: ' + f.nome;
    document.getElementById('fichaHeader').style.background = 'linear-gradient(135deg, #ff9800, #e65100)';
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="nova-ficha"]').classList.add('active');
    document.getElementById('page-nova-ficha').classList.add('active');
    refreshIngSelects(); window.scrollTo(0, 0);
}

function excluirFicha(id) { if (confirm('Excluir?')) { DB.fichas = DB.fichas.filter(f => f.id !== id); salvarDados(); renderFichas(); } }

function duplicarFicha(id) {
    const f = DB.fichas.find(x => x.id === id);
    if (f) { DB.fichas.push({ ...f, id: gerarId(), nome: f.nome + ' (Cópia)' }); salvarDados(); renderFichas(); }
}

function renderFichas() {
    DB.fichas.forEach(f => { f.custoMassa = f.incMassa !== false ? getCustoMassa(f.tamanho) : 0; f.custoFixo = getCustoFixo(); f.custoTotal = (f.custoIng || 0) + f.custoMassa + f.custoFixo; f.lucro = f.precoVenda - f.custoTotal; f.cmv = f.precoVenda > 0 ? (f.custoTotal / f.precoVenda) * 100 : 0; });
    const cnt = { P: 0, M: 0, G: 0, GG: 0 };
    DB.fichas.forEach(f => { if (cnt[f.tamanho] !== undefined) cnt[f.tamanho]++; });
    document.getElementById('cntAll').textContent = DB.fichas.length;
    document.getElementById('cntTabP').textContent = cnt.P;
    document.getElementById('cntTabM').textContent = cnt.M;
    document.getElementById('cntTabG').textContent = cnt.G;
    document.getElementById('cntTabGG').textContent = cnt.GG;
    let fichas = filtroTam === 'all' ? DB.fichas : DB.fichas.filter(f => f.tamanho === filtroTam);
    const grid = document.getElementById('fichasGrid');
    if (fichas.length === 0) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="icon">📋</div>Nenhuma ficha</div>'; return; }
    grid.innerHTML = fichas.map(f => `<div class="ficha-card ${f.tamanho}"><div class="ficha-header"><div><h3>${f.nome}</h3><small>${f.categoria}</small></div><span class="badge-size ${f.tamanho}">${f.tamanho}</span></div><div class="ficha-body"><div class="ficha-stats"><div class="ficha-stat"><small>Custo</small><div class="val red">R$ ${f.custoTotal.toFixed(2)}</div></div><div class="ficha-stat"><small>Venda</small><div class="val blue">R$ ${f.precoVenda.toFixed(2)}</div></div><div class="ficha-stat"><small>Lucro</small><div class="val green">R$ ${f.lucro.toFixed(2)}</div></div></div><div class="ficha-details">Ing: R$${(f.custoIng || 0).toFixed(2)} | Massa: R$${f.custoMassa.toFixed(2)} | Fixo: R$${f.custoFixo.toFixed(2)} | CMV: ${f.cmv.toFixed(1)}%</div><div class="ficha-actions"><button class="btn btn-warning btn-sm" onclick="editarFicha('${f.id}')">✏️</button><button class="btn btn-purple btn-sm" onclick="duplicarFicha('${f.id}')">📋</button><button class="btn btn-danger btn-sm" onclick="excluirFicha('${f.id}')">🗑️</button></div></div></div>`).join('');
}

function filtrarTamanho(tam, btn) { filtroTam = tam; document.querySelectorAll('.size-tab').forEach(t => t.classList.remove('active')); btn.classList.add('active'); renderFichas(); }

function filtrarFichas() {
    const busca = document.getElementById('buscaFic').value.toLowerCase();
    document.querySelectorAll('.ficha-card').forEach(c => { c.style.display = c.textContent.toLowerCase().includes(busca) ? '' : 'none'; });
}

// ===== DASHBOARD =====
function renderDashboard() {
    DB.fichas.forEach(f => { f.custoMassa = f.incMassa !== false ? getCustoMassa(f.tamanho) : 0; f.custoFixo = getCustoFixo(); f.custoTotal = (f.custoIng || 0) + f.custoMassa + f.custoFixo; f.lucro = f.precoVenda - f.custoTotal; });
    const cnt = { P: 0, M: 0, G: 0, GG: 0 };
    DB.fichas.forEach(f => { if (cnt[f.tamanho] !== undefined) cnt[f.tamanho]++; });
    document.getElementById('cntP').textContent = cnt.P;
    document.getElementById('cntM').textContent = cnt.M;
    document.getElementById('cntG').textContent = cnt.G;
    document.getElementById('cntGG').textContent = cnt.GG;
    document.getElementById('dashIns').textContent = DB.insumos.length;
    document.getElementById('dashFic').textContent = DB.fichas.length;
    document.getElementById('dashCF').textContent = 'R$ ' + getCustoFixo().toFixed(2);
    document.getElementById('dashMassaM').textContent = 'R$ ' + getCustoMassa('M').toFixed(2);
    document.getElementById('dashMassaG').textContent = 'R$ ' + getCustoMassa('G').toFixed(2);
    if (DB.fichas.length > 0) {
        const top = [...DB.fichas].sort((a, b) => b.lucro - a.lucro).slice(0, 5);
        document.getElementById('topLista').innerHTML = `<table><thead><tr><th>#</th><th>Pizza</th><th>Tam</th><th>Custo</th><th>Venda</th><th>Lucro</th></tr></thead><tbody>${top.map((f, i) => `<tr><td>${i + 1}º</td><td><strong>${f.nome}</strong></td><td><span class="badge-size ${f.tamanho}" style="padding:2px 8px;font-size:0.75em">${f.tamanho}</span></td><td>R$ ${f.custoTotal.toFixed(2)}</td><td>R$ ${f.precoVenda.toFixed(2)}</td><td style="color:var(--success);font-weight:bold">R$ ${f.lucro.toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
    } else { document.getElementById('topLista').innerHTML = '<div class="empty">Cadastre fichas</div>'; }
    // Salgados no dashboard
    document.getElementById('cntSAL').textContent = DB.salgados.length;
}

// ===== PRECIFICAR =====
function loadFichasSelect() {
    document.getElementById('calcFicha').innerHTML = '<option value="">-- Selecione --</option>' + DB.fichas.map(f => `<option value="${f.id}">${f.nome} (${f.tamanho})</option>`).join('');
}

function calcPorCMV() {
    const custo = parseFloat(document.getElementById('calcCusto').value) || 0;
    const cmv = parseFloat(document.getElementById('calcCMV').value) || 30;
    document.getElementById('calcCMVVal').textContent = cmv + '%';
    if (custo > 0) {
        const preco = custo / (cmv / 100);
        document.getElementById('calcPreco').textContent = 'R$ ' + preco.toFixed(2);
        document.getElementById('calcLucro').textContent = 'Lucro: R$ ' + (preco - custo).toFixed(2);
    }
}

function calcComFicha() {
    const id = document.getElementById('calcFicha').value;
    const res = document.getElementById('calcFichaRes');
    if (!id) { res.style.display = 'none'; return; }
    const f = DB.fichas.find(x => x.id == id); if (!f) return;
    const custoMassa = f.incMassa !== false ? getCustoMassa(f.tamanho) : 0;
    const custoFixo = getCustoFixo();
    const custoTotal = (f.custoIng || 0) + custoMassa + custoFixo;
    res.style.display = 'block';
    document.getElementById('cfIng').textContent = 'R$ ' + (f.custoIng || 0).toFixed(2);
    document.getElementById('cfMassaVal').textContent = 'R$ ' + custoMassa.toFixed(2);
    document.getElementById('cfFixo').textContent = 'R$ ' + custoFixo.toFixed(2);
    document.getElementById('cfTot').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('cfP35').textContent = 'R$ ' + (custoTotal / 0.35).toFixed(2);
    document.getElementById('cfP30').textContent = 'R$ ' + (custoTotal / 0.30).toFixed(2);
    document.getElementById('cfP25').textContent = 'R$ ' + (custoTotal / 0.25).toFixed(2);
}

// ===== EXPORT/IMPORT =====
function exportar() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'pizzacontrol_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); status('📥 Exportado!');
}

function importar(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const d = JSON.parse(ev.target.result);
            if (confirm('Importar dados?')) {
                if (d.insumos) d.insumos.forEach(i => { i.id = gerarId(); DB.insumos.push(i); });
                if (d.fichas) d.fichas.forEach(f => { f.id = gerarId(); DB.fichas.push(f); });
                if (d.salgados) d.salgados.forEach(s => { s.id = gerarId(); DB.salgados.push(s); });
                if (d.custos) DB.custos = d.custos;
                if (d.massa) DB.massa = d.massa;
                salvarDados(); location.reload();
            }
        } catch (err) { alert('❌ Erro!'); }
    };
    reader.readAsText(file); e.target.value = '';
}

function limparTudo() {
    if (confirm('⚠️ Apagar TUDO?')) {
        if (confirm('Backup antes?')) exportar();
        DB = { insumos: [], fichas: [], salgados: [], custos: DB.custos, massa: DB.massa };
        salvarDados(); location.reload();
    }
}

// ===== SALGADOS =====
function getCustoFixoSalgado() {
    const c = DB.custos;
    const total = (c.aluguel || 0) + (c.energia || 0) + (c.gas || 0) + (c.agua || 0) + (c.internet || 0) + (c.func || 0) + (c.gasolina || 0) + (c.emb || 0) + (c.mkt || 0) + (c.contador || 0) + (c.outros || 0);
    return total / (c.salgadosMes || 500);
}

function refreshIngSalgadoSelects() {
    document.querySelectorAll('#salgIngLista select').forEach(sel => {
        const val = sel.value;
        sel.innerHTML = '<option value="">Selecione...</option>' + DB.insumos.map(i => `<option value="${i.id}">${i.nome} (R$${(i.custoUn || 0).toFixed(4)}/${i.unidade})</option>`).join('');
        sel.value = val;
    });
}

function addIngSalgado(insId = null, qtd = null) {
    const lista = document.getElementById('salgIngLista');
    const div = document.createElement('div'); div.className = 'ingrediente-item';
    div.innerHTML = `<select class="form-control" onchange="calcSalgado()"><option value="">Selecione...</option>${DB.insumos.map(i => `<option value="${i.id}" ${insId == i.id ? 'selected' : ''}>${i.nome} (R$${(i.custoUn || 0).toFixed(4)}/${i.unidade})</option>`).join('')}</select><input type="number" class="form-control" placeholder="Qtd" value="${qtd || ''}" oninput="calcSalgado()"><span class="custo">R$ 0</span><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcSalgado()">✕</button>`;
    lista.appendChild(div);
    if (qtd) setTimeout(calcSalgado, 50);
}

function calcSalgado() {
    let custoIng = 0;
    document.querySelectorAll('#salgIngLista .ingrediente-item').forEach(item => {
        const sel = item.querySelector('select'); const inp = item.querySelector('input'); const span = item.querySelector('.custo');
        const id = sel.value; const qtd = parseFloat(inp.value) || 0;
        if (id && qtd > 0) { const ins = DB.insumos.find(i => i.id == id); if (ins) { const custo = (ins.custoUn || 0) * qtd; custoIng += custo; span.textContent = 'R$ ' + custo.toFixed(2); } }
        else { span.textContent = 'R$ 0'; }
    });
    const rendimento = parseFloat(document.getElementById('salgRendimento').value) || 0;
    const custoUn = rendimento > 0 ? custoIng / rendimento : 0;
    const custoFixo = getCustoFixoSalgado();
    const custoTotal = custoUn + custoFixo;
    const venda = parseFloat(document.getElementById('salgPreco').value) || 0;
    const lucro = venda - custoTotal;
    const cmv = venda > 0 ? (custoTotal / venda) * 100 : 0;
    const margem = venda > 0 ? (lucro / venda) * 100 : 0;
    document.getElementById('resSalgReceita').textContent = 'R$ ' + custoIng.toFixed(2);
    document.getElementById('resSalgRend').textContent = rendimento + ' un';
    document.getElementById('resSalgCustoUn').textContent = 'R$ ' + custoUn.toFixed(2);
    document.getElementById('resSalgCF').textContent = 'R$ ' + custoFixo.toFixed(2);
    document.getElementById('resSalgTotal').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('resSalgVenda').textContent = 'R$ ' + venda.toFixed(2);
    document.getElementById('resSalgLucro').textContent = 'R$ ' + lucro.toFixed(2);
    document.getElementById('resSalgLucro').className = 'val ' + (lucro >= 0 ? 'green' : 'red');
    document.getElementById('resSalgCMV').textContent = cmv.toFixed(1) + '%';
    document.getElementById('resSalgMargem').textContent = margem.toFixed(1) + '%';
    const bar = document.getElementById('salgCmvBar');
    bar.style.width = Math.min(cmv, 100) + '%';
    bar.className = 'cmv-fill ' + (cmv <= 30 ? 'good' : cmv <= 35 ? 'medium' : 'bad');
}

function salvarSalgado() {
    const nome = document.getElementById('salgNome').value.trim();
    const cat = document.getElementById('salgCat').value;
    const rendimento = parseFloat(document.getElementById('salgRendimento').value) || 0;
    const preco = parseFloat(document.getElementById('salgPreco').value) || 0;
    if (!nome || rendimento <= 0 || preco <= 0) { alert('⚠️ Preencha nome, rendimento e preço!'); return; }
    const ingredientes = []; let custoIng = 0;
    document.querySelectorAll('#salgIngLista .ingrediente-item').forEach(item => {
        const id = item.querySelector('select').value; const qtd = parseFloat(item.querySelector('input').value) || 0;
        if (id && qtd > 0) { const ins = DB.insumos.find(i => i.id == id); if (ins) { const custo = (ins.custoUn || 0) * qtd; custoIng += custo; ingredientes.push({ insumoId: id, nome: ins.nome, quantidade: qtd, unidade: ins.unidade, custo }); } }
    });
    if (ingredientes.length === 0) { alert('⚠️ Adicione ingredientes!'); return; }
    const custoUn = custoIng / rendimento;
    const custoFixo = getCustoFixoSalgado();
    const custoTotal = custoUn + custoFixo;
    const salgado = { nome, categoria: cat, rendimento, precoVenda: preco, ingredientes, custoIng, custoUn, custoFixo, custoTotal, lucro: preco - custoTotal, cmv: (custoTotal / preco) * 100 };
    if (editandoSalgadoId) {
        const idx = DB.salgados.findIndex(s => s.id === editandoSalgadoId);
        if (idx >= 0) DB.salgados[idx] = { ...DB.salgados[idx], ...salgado };
        editandoSalgadoId = null;
    } else { salgado.id = gerarId(); DB.salgados.push(salgado); }
    salvarDados(); limparSalgado();
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="salgados"]').classList.add('active');
    document.getElementById('page-salgados').classList.add('active');
    renderSalgados();
}

function limparSalgado() {
    editandoSalgadoId = null;
    document.getElementById('salgNome').value = '';
    document.getElementById('salgPreco').value = '';
    document.getElementById('salgRendimento').value = '';
    document.getElementById('salgIngLista').innerHTML = '';
    document.getElementById('salgadoHeader').textContent = '➕ Nova Ficha de Salgado';
    document.getElementById('salgadoHeader').style.background = '';
    document.getElementById('salgCat').value = 'Frito';
    addIngSalgado(); calcSalgado();
}

function editarSalgado(id) {
    const s = DB.salgados.find(x => x.id === id); if (!s) return;
    editandoSalgadoId = id;
    document.getElementById('salgNome').value = s.nome;
    document.getElementById('salgCat').value = s.categoria;
    document.getElementById('salgRendimento').value = s.rendimento;
    document.getElementById('salgPreco').value = s.precoVenda;
    document.getElementById('salgIngLista').innerHTML = '';
    (s.ingredientes || []).forEach(ing => addIngSalgado(ing.insumoId, ing.quantidade));
    calcSalgado();
    document.getElementById('salgadoHeader').textContent = '✏️ Editando: ' + s.nome;
    document.getElementById('salgadoHeader').style.background = 'linear-gradient(135deg, #ff9800, #e65100)';
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="novo-salgado"]').classList.add('active');
    document.getElementById('page-novo-salgado').classList.add('active');
    refreshIngSalgadoSelects(); window.scrollTo(0, 0);
}

function excluirSalgado(id) { if (confirm('Excluir salgado?')) { DB.salgados = DB.salgados.filter(s => s.id !== id); salvarDados(); renderSalgados(); } }

function duplicarSalgado(id) {
    const s = DB.salgados.find(x => x.id === id);
    if (s) { DB.salgados.push({ ...s, id: gerarId(), nome: s.nome + ' (Cópia)' }); salvarDados(); renderSalgados(); }
}

function renderSalgados() {
    DB.salgados.forEach(s => {
        let custoIng = 0;
        (s.ingredientes || []).forEach(ing => { const ins = DB.insumos.find(i => i.id == ing.insumoId); if (ins) custoIng += (ins.custoUn || 0) * ing.quantidade; });
        s.custoIng = custoIng;
        s.custoUn = s.rendimento > 0 ? custoIng / s.rendimento : 0;
        s.custoFixo = getCustoFixoSalgado();
        s.custoTotal = s.custoUn + s.custoFixo;
        s.lucro = s.precoVenda - s.custoTotal;
        s.cmv = s.precoVenda > 0 ? (s.custoTotal / s.precoVenda) * 100 : 0;
    });
    document.getElementById('salgadosCount').textContent = DB.salgados.length + ' salgados cadastrados';
    const grid = document.getElementById('salgadosGrid');
    if (DB.salgados.length === 0) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="icon">🥟</div>Nenhum salgado cadastrado</div>'; return; }
    grid.innerHTML = DB.salgados.map(s => `<div class="salgado-card"><div class="salgado-header"><div><h3>${s.nome}</h3><small>${s.categoria} · Rende ${s.rendimento} un</small></div><span class="badge-salgado">${s.categoria}</span></div><div class="salgado-body"><div class="salgado-stats"><div class="salgado-stat"><small>Custo/Un</small><div class="val red">R$ ${s.custoTotal.toFixed(2)}</div></div><div class="salgado-stat"><small>Venda/Un</small><div class="val blue">R$ ${s.precoVenda.toFixed(2)}</div></div><div class="salgado-stat"><small>Lucro/Un</small><div class="val green">R$ ${s.lucro.toFixed(2)}</div></div></div><div class="salgado-details">Receita: R$${s.custoIng.toFixed(2)} ÷ ${s.rendimento}un = R$${s.custoUn.toFixed(2)}/un | Fixo: R$${s.custoFixo.toFixed(2)} | CMV: ${s.cmv.toFixed(1)}%</div><div class="salgado-actions"><button class="btn btn-warning btn-sm" onclick="editarSalgado('${s.id}')">✏️</button><button class="btn btn-purple btn-sm" onclick="duplicarSalgado('${s.id}')">📋</button><button class="btn btn-danger btn-sm" onclick="excluirSalgado('${s.id}')">🗑️</button></div></div></div>`).join('');
}

function filtrarSalgados() {
    const busca = document.getElementById('buscaSalg').value.toLowerCase();
    document.querySelectorAll('.salgado-card').forEach(c => { c.style.display = c.textContent.toLowerCase().includes(busca) ? '' : 'none'; });
}

// ===== MODAIS =====
document.querySelectorAll('.modal-bg').forEach(m => { m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); }); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal-bg.show').forEach(m => m.classList.remove('show')); });
