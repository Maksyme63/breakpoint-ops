<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Breakpoint OPS V2</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <style>
    :root{
      --bg:#f3f5f7;
      --card:#ffffff;
      --text:#14212b;
      --muted:#667381;
      --border:#dce3e8;
      --green:#2d4a3e;
      --green-2:#3f6656;
      --blue:#1f5eff;
      --orange:#f0a126;
      --red:#d94444;
      --ok:#20b26b;
      --shadow:0 8px 30px rgba(0,0,0,.08);
      --radius:18px;
    }
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    body{margin:0;background:var(--bg);font-family:Inter,system-ui,sans-serif;color:var(--text);max-width:520px;margin-inline:auto;min-height:100vh}
    .hidden{display:none!important}
    .screen{display:none;min-height:100vh}
    .screen.active{display:block}
    .header{position:sticky;top:0;z-index:20;background:var(--green);color:#fff;padding:14px 16px;box-shadow:0 4px 20px rgba(0,0,0,.18)}
    .header-row{display:flex;align-items:center;gap:12px}
    .back-btn,.menu-btn{width:42px;height:42px;border:0;border-radius:12px;background:rgba(255,255,255,.15);color:#fff;font-size:18px;font-weight:800}
    .title-wrap{flex:1;min-width:0}
    .title{font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .subtitle{font-size:12px;opacity:.75;margin-top:2px}
    .badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700}
    .badge.red{background:var(--red);color:#fff}
    .badge.gray{background:#e9eef2;color:#4e5c67}
    .hero{padding:28px 18px;background:linear-gradient(135deg,var(--green),var(--green-2));color:#fff}
    .hero h1{margin:0;font-size:28px;line-height:1.05;font-weight:800}
    .hero p{margin:8px 0 0;opacity:.82;font-size:14px}
    .content{padding:18px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
    .stack{display:flex;flex-direction:column;gap:12px}
    .station-btn,.module-btn,.home-btn,.soft-btn,.primary-btn,.danger-btn{font:inherit;cursor:pointer}
    .station-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px;border:1px solid var(--border);background:#fff;border-radius:16px;font-weight:700}
    .station-btn .meta{display:flex;flex-direction:column;gap:4px;text-align:left}
    .station-btn .meta small{color:var(--muted);font-weight:600}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .module-btn,.home-btn{border:0;border-radius:18px;padding:18px;color:#fff;min-height:128px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;box-shadow:var(--shadow)}
    .module-btn.active,.home-btn.active{background:linear-gradient(135deg,#264338,#406757)}
    .module-btn.disabled,.home-btn.disabled{background:linear-gradient(135deg,#9aa7b2,#788793)}
    .module-btn.orange{background:linear-gradient(135deg,#f4ad37,#db8d15)}
    .btn-ico{font-size:28px}
    .btn-title{font-size:17px;font-weight:800;line-height:1.1}
    .btn-sub{font-size:12px;opacity:.85}
    .section-title{font-size:20px;font-weight:800;margin:0 0 4px}
    .section-sub{font-size:13px;color:var(--muted);margin:0 0 16px}
    .panel{padding:16px}
    label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:0 0 8px}
    input,select{width:100%;border:1px solid var(--border);background:#fff;border-radius:14px;padding:14px;font:inherit}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .row-3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .qty{display:grid;grid-template-columns:56px 1fr 56px;gap:8px;align-items:center}
    .qty button{height:52px;border:0;border-radius:14px;background:var(--green);color:#fff;font-size:24px;font-weight:800}
    .chips{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
    .chip{border:1px solid var(--border);border-radius:12px;padding:11px 0;background:#fff;font-weight:700;text-align:center;cursor:pointer}
    .chip.selected{background:var(--green);color:#fff;border-color:var(--green)}
    .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:14px}
    .soft-btn{border:1px solid var(--border);background:#fff;border-radius:14px;padding:12px 14px;font-weight:700}
    .primary-btn{border:0;background:var(--ok);color:#fff;border-radius:16px;padding:15px 16px;font-weight:800;width:100%}
    .danger-btn{border:0;background:var(--red);color:#fff;border-radius:12px;padding:11px 14px;font-weight:800}
    .list{display:flex;flex-direction:column;gap:12px}
    .alert-card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:14px;box-shadow:var(--shadow)}
    .alert-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .alert-name{font-size:16px;font-weight:800;margin:0 0 6px}
    .alert-meta{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px}
    .alert-actions{display:flex;gap:10px;margin-top:14px}
    .alert-actions .soft-btn,.alert-actions .primary-btn{width:auto;flex:1}
    .notice{padding:14px;border-radius:14px;background:#eef4f8;color:#355061;font-size:13px;font-weight:600}
    .error{background:#fff1f1;color:#9d2c2c}
    .success{background:#ecfaf2;color:#16623b}
    .empty{padding:30px 18px;text-align:center;color:var(--muted);font-weight:600}
    .loader{padding:18px;text-align:center;color:var(--muted);font-weight:700}
    .footer-space{height:30px}
  </style>
</head>
<body>
  <section id="screen-stations" class="screen active">
    <div class="hero">
      <h1>Breakpoint OPS</h1>
      <p>Sélectionne une station pour entrer dans l’application.</p>
    </div>
    <div class="content">
      <div class="card panel">
        <h2 class="section-title">Choix de la station</h2>
        <p class="section-sub">Obligatoire avant d’accéder aux modules.</p>
        <div id="stations-list" class="stack"></div>
      </div>
    </div>
  </section>

  <section id="screen-modules" class="screen">
    <div class="header">
      <div class="header-row">
        <button class="back-btn" onclick="goStations()">←</button>
        <div class="title-wrap">
          <div id="current-station-title" class="title">Station</div>
          <div class="subtitle">Breakpoint OPS</div>
        </div>
      </div>
    </div>
    <div class="hero">
      <h1>Modules</h1>
      <p>Choisis un module. Les modules non prêts restent visibles mais bloqués.</p>
    </div>
    <div class="content">
      <div class="stack">
        <button class="module-btn active" onclick="openStockHome()">
          <div class="btn-ico">📦</div>
          <div>
            <div class="btn-title">Gestion de stock</div>
            <div class="btn-sub">Module actif</div>
          </div>
        </button>
        <button class="module-btn orange disabled" onclick="soon()">
          <div class="btn-ico">🥐</div>
          <div>
            <div class="btn-title">Boulangerie</div>
            <div class="btn-sub">Bientôt disponible</div>
          </div>
        </button>
        <button class="module-btn disabled" onclick="soon()">
          <div class="btn-ico">🛠️</div>
          <div>
            <div class="btn-title">Maintenance</div>
            <div class="btn-sub">Bientôt disponible</div>
          </div>
        </button>
      </div>
    </div>
  </section>

  <section id="screen-stock-home" class="screen">
    <div class="header">
      <div class="header-row">
        <button class="back-btn" onclick="goModules()">←</button>
        <div class="title-wrap">
          <div class="title">Gestion de stock</div>
          <div id="stock-home-subtitle" class="subtitle">Station</div>
        </div>
      </div>
    </div>
    <div class="content">
      <h2 class="section-title">Accueil du module</h2>
      <p class="section-sub">Accès rapide aux fonctions du stock.</p>
      <div class="grid-2">
        <button class="home-btn active" onclick="openReception()">
          <div class="btn-ico">🚚</div>
          <div>
            <div class="btn-title">Réception livraison</div>
            <div class="btn-sub">Enregistrer un lot</div>
          </div>
        </button>
        <button class="home-btn active" onclick="openAlerts()">
          <div class="btn-ico">⚠️</div>
          <div>
            <div class="btn-title">Alertes DLC</div>
            <div class="btn-sub">Produits à traiter</div>
          </div>
        </button>
        <button class="home-btn disabled" onclick="soon()">
          <div class="btn-ico">🔄</div>
          <div>
            <div class="btn-title">Transfert inter-site</div>
            <div class="btn-sub">Bientôt disponible</div>
          </div>
        </button>
        <button class="home-btn disabled" onclick="soon()">
          <div class="btn-ico">🔎</div>
          <div>
            <div class="btn-title">Rechercher un produit</div>
            <div class="btn-sub">Bientôt disponible</div>
          </div>
        </button>
      </div>
    </div>
  </section>

  <section id="screen-reception" class="screen">
    <div class="header">
      <div class="header-row">
        <button class="back-btn" onclick="openStockHome()">←</button>
        <div class="title-wrap">
          <div class="title">Réception livraison</div>
          <div id="reception-subtitle" class="subtitle">Station</div>
        </div>
      </div>
    </div>
    <div class="content stack">
      <div id="reception-message" class="notice hidden"></div>
      <div class="card panel stack">
        <div>
          <label for="ean">EAN</label>
          <div class="toolbar">
            <input id="ean" type="text" inputmode="numeric" placeholder="Scanne ou saisis le code EAN" />
            <button class="soft-btn" onclick="lookupProduct()">Chercher</button>
          </div>
        </div>

        <div>
          <label for="nom">Nom du produit</label>
          <input id="nom" type="text" placeholder="Nom du produit" />
        </div>

        <div>
          <label for="photo_url">Photo du produit</label>
          <input id="photo_url" type="url" placeholder="https://..." />
        </div>

        <div class="row">
          <div>
            <label for="dlc">DLC</label>
            <input id="dlc" type="date" />
          </div>
          <div>
            <label for="station_display">Station</label>
            <input id="station_display" type="text" disabled />
          </div>
        </div>

        <div>
          <label>Quantité</label>
          <div class="qty">
            <button onclick="changeQty(-1)">−</button>
            <input id="quantite" type="number" min="1" value="1" />
            <button onclick="changeQty(1)">+</button>
          </div>
        </div>

        <div>
          <label>Emplacements</label>
          <div id="chips-emplacements" class="chips"></div>
        </div>

        <button class="primary-btn" onclick="saveReception()">Valider la réception</button>
      </div>
      <div class="footer-space"></div>
    </div>
  </section>

  <section id="screen-alerts" class="screen">
    <div class="header">
      <div class="header-row">
        <button class="back-btn" onclick="openStockHome()">←</button>
        <div class="title-wrap">
          <div class="title">Alertes DLC</div>
          <div id="alerts-subtitle" class="subtitle">Station</div>
        </div>
        <span id="alerts-count" class="badge red">0</span>
      </div>
    </div>
    <div class="content">
      <div class="toolbar">
        <button class="soft-btn" onclick="loadAlerts(true)">Actualiser</button>
      </div>
      <div id="alerts-message" class="notice hidden"></div>
      <div id="alerts-loader" class="loader hidden">Chargement…</div>
      <div id="alerts-list" class="list"></div>
      <div class="footer-space"></div>
    </div>
  </section>

  <script>
    const SUPABASE_URL = 'https://hhsvazolktxqntyhuqqj.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_qr4Qq4OB-Qt1G8a0GO3WKw_IJxfRbl9';
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const STATIONS = ['Evere','Wemmel','Molenbeek','Fort-Jaco','Uccle','Etterbeek','Auderghem'];
    const EMPLACEMENTS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

    const state = {
      station: null,
      emplacements: new Set(),
      alerts: []
    };

    function showScreen(id){
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    function soon(){
      alert('Fonction disponible prochainement');
    }

    function renderStations(){
      const wrap = document.getElementById('stations-list');
      wrap.innerHTML = '';
      STATIONS.forEach(station => {
        const btn = document.createElement('button');
        btn.className = 'station-btn';
        btn.innerHTML = `
          <div class="meta">
            <span>${station}</span>
            <small>Station Breakpoint</small>
          </div>
          <span>→</span>
        `;
        btn.onclick = () => selectStation(station);
        wrap.appendChild(btn);
      });
    }

    function selectStation(station){
      state.station = station;
      document.getElementById('current-station-title').textContent = station;
      document.getElementById('stock-home-subtitle').textContent = station;
      document.getElementById('reception-subtitle').textContent = station;
      document.getElementById('alerts-subtitle').textContent = station;
      document.getElementById('station_display').value = station;
      showScreen('screen-modules');
    }

    function goStations(){ showScreen('screen-stations'); }
    function goModules(){ showScreen('screen-modules'); }
    function openStockHome(){ showScreen('screen-stock-home'); }
    function openReception(){ showScreen('screen-reception'); }
    function openAlerts(){ showScreen('screen-alerts'); loadAlerts(true); }

    function renderEmplacements(){
      const wrap = document.getElementById('chips-emplacements');
      wrap.innerHTML = '';
      EMPLACEMENTS.forEach(letter => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.textContent = letter;
        btn.onclick = () => {
          if(state.emplacements.has(letter)) state.emplacements.delete(letter);
          else state.emplacements.add(letter);
          btn.classList.toggle('selected');
        };
        wrap.appendChild(btn);
      });
    }

    function resetReceptionForm(){
      document.getElementById('ean').value = '';
      document.getElementById('nom').value = '';
      document.getElementById('photo_url').value = '';
      document.getElementById('dlc').value = '';
      document.getElementById('quantite').value = 1;
      state.emplacements = new Set();
      document.querySelectorAll('#chips-emplacements .chip').forEach(c => c.classList.remove('selected'));
    }

    function changeQty(delta){
      const input = document.getElementById('quantite');
      const next = Math.max(1, Number(input.value || 1) + delta);
      input.value = next;
    }

    function setBoxMessage(id, text, type=''){ 
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = `notice ${type}`;
      el.classList.remove('hidden');
    }

    function hideBoxMessage(id){
      const el = document.getElementById(id);
      el.className = 'notice hidden';
      el.textContent = '';
    }

    async function lookupProduct(){
      hideBoxMessage('reception-message');
      const ean = document.getElementById('ean').value.trim();
      if(!ean){
        setBoxMessage('reception-message', 'Saisis un EAN avant la recherche.', 'error');
        return;
      }

      const { data, error } = await supabaseClient
        .from('produits')
        .select('ean, nom, photo_url')
        .eq('ean', ean)
        .maybeSingle();

      if(error){
        setBoxMessage('reception-message', `Erreur Supabase : ${error.message}`, 'error');
        return;
      }

      if(data){
        document.getElementById('nom').value = data.nom || '';
        document.getElementById('photo_url').value = data.photo_url || '';
        setBoxMessage('reception-message', 'Produit trouvé. Les informations ont été remplies.', 'success');
      } else {
        document.getElementById('nom').value = '';
        document.getElementById('photo_url').value = '';
        setBoxMessage('reception-message', 'Produit inconnu. Renseigne le nom et la photo si besoin.', '');
      }
    }

    async function saveReception(){
      hideBoxMessage('reception-message');
      const ean = document.getElementById('ean').value.trim();
      const nom = document.getElementById('nom').value.trim();
      const photo_url = document.getElementById('photo_url').value.trim() || null;
      const dlc = document.getElementById('dlc').value;
      const quantite = Number(document.getElementById('quantite').value || 0);
      const emplacements = [...state.emplacements];

      if(!state.station) return setBoxMessage('reception-message', 'Choisis une station avant de continuer.', 'error');
      if(!ean) return setBoxMessage('reception-message', 'Le code EAN est obligatoire.', 'error');
      if(!nom) return setBoxMessage('reception-message', 'Le nom du produit est obligatoire.', 'error');
      if(!dlc) return setBoxMessage('reception-message', 'La DLC est obligatoire.', 'error');
      if(!quantite || quantite < 1) return setBoxMessage('reception-message', 'La quantité doit être au moins de 1.', 'error');
      if(emplacements.length === 0) return setBoxMessage('reception-message', 'Sélectionne au moins un emplacement.', 'error');

      const { error: productError } = await supabaseClient
        .from('produits')
        .upsert([{ ean, nom, photo_url }], { onConflict: 'ean' });

      if(productError){
        setBoxMessage('reception-message', `Erreur produit : ${productError.message}`, 'error');
        return;
      }

      const { error: lotError } = await supabaseClient
        .from('lots')
        .insert([{
          ean,
          station: state.station,
          dlc,
          quantite,
          emplacements,
          statut: 'actif'
        }]);

      if(lotError){
        setBoxMessage('reception-message', `Erreur lot : ${lotError.message}`, 'error');
        return;
      }

      setBoxMessage('reception-message', 'Réception enregistrée dans Supabase.', 'success');
      resetReceptionForm();
    }

    function daysUntil(dateString){
      const today = new Date();
      today.setHours(0,0,0,0);
      const target = new Date(dateString + 'T00:00:00');
      return Math.round((target - today) / 86400000);
    }

    function alertBadge(days, statut){
      if(statut === 'traite') return `<span class="badge gray">Traité</span>`;
      if(days < 0) return `<span class="badge red">Expiré</span>`;
      if(days === 0) return `<span class="badge red">Expire aujourd’hui</span>`;
      return `<span class="badge red">J-${days}</span>`;
    }

    async function loadAlerts(showMsg=false){
      if(!state.station) return;
      hideBoxMessage('alerts-message');
      document.getElementById('alerts-loader').classList.remove('hidden');
      document.getElementById('alerts-list').innerHTML = '';

      const { data, error } = await supabaseClient
        .from('lots')
        .select('id, ean, station, dlc, quantite, date_entree, emplacements, statut, produits(nom, photo_url)')
        .eq('station', state.station)
        .in('statut', ['actif','traite'])
        .order('dlc', { ascending: true });

      document.getElementById('alerts-loader').classList.add('hidden');

      if(error){
        setBoxMessage('alerts-message', `Erreur Supabase : ${error.message}`, 'error');
        return;
      }

      const filtered = (data || []).filter(item => {
        const days = daysUntil(item.dlc);
        if(item.statut === 'actif') return days <= 5;
        return days >= -3;
      });

      state.alerts = filtered;
      document.getElementById('alerts-count').textContent = String(filtered.length);
      renderAlerts();
      if(showMsg) setBoxMessage('alerts-message', 'Liste des alertes actualisée.', 'success');
    }

    function renderAlerts(){
      const wrap = document.getElementById('alerts-list');
      wrap.innerHTML = '';

      if(state.alerts.length === 0){
        wrap.innerHTML = `<div class="empty card">Aucune alerte DLC pour cette station.</div>`;
        return;
      }

      state.alerts.forEach(item => {
        const days = daysUntil(item.dlc);
        const nom = item.produits?.nom || item.ean;
        const emplacements = Array.isArray(item.emplacements) ? item.emplacements.join(', ') : '';
        const card = document.createElement('div');
        card.className = 'alert-card';
        card.innerHTML = `
          <div class="alert-top">
            <div>
              <p class="alert-name">${escapeHtml(nom)}</p>
              <div class="alert-meta">
                <span>EAN : ${escapeHtml(item.ean)}</span>
                <span>DLC : ${escapeHtml(item.dlc)}</span>
                <span>Qté : ${item.quantite}</span>
                <span>Emp. : ${escapeHtml(emplacements)}</span>
              </div>
            </div>
            ${alertBadge(days, item.statut)}
          </div>
          <div class="alert-actions">
            ${item.statut === 'actif'
              ? `<button class="primary-btn" onclick="markTreated('${item.id}')">Marquer comme traité</button>`
              : `<button class="soft-btn" disabled>Déjà traité</button>`}
          </div>
        `;
        wrap.appendChild(card);
      });
    }

    async function markTreated(id){
      hideBoxMessage('alerts-message');
      const { error } = await supabaseClient
        .from('lots')
        .update({ statut: 'traite' })
        .eq('id', id);

      if(error){
        setBoxMessage('alerts-message', `Impossible de mettre à jour le statut : ${error.message}`, 'error');
        return;
      }
      setBoxMessage('alerts-message', 'Le lot a été marqué comme traité.', 'success');
      await loadAlerts(false);
    }

    function escapeHtml(value){
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    renderStations();
    renderEmplacements();
  </script>
</body>
</html>
