const API_KEY = '87a13cf2373f492ad3f28c6961c75223'; 
let mapa = null;
let marcador = null;
let dadosPrevisao = []; 
let abaAtual = 0;

function inicializarMapa(lat, lon) {
    if (typeof L === 'undefined') return;
    var latitude = lat || -27.5954;
    var longitude = lon || -48.5480;
    if (!mapa) {
        mapa = L.map('mapa', { zoomControl: true }).setView([latitude, longitude], 14); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
        marcador = L.marker([latitude, longitude]).addTo(mapa);
    } else {
        mapa.setView([latitude, longitude], 14);
        marcador.setLatLng([latitude, longitude]);
    }
}

async function descobrirBairroExato(lat, lon) {
    try {
        // Correção na URL do geocoding reverso do OpenStreetMap (Nominatim)
        var urlGeo = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
        const resposta = await fetch(urlGeo, { headers: { 'Accept-Language': 'pt-BR' } });
        if (!resposta.ok) return null;
        const resultado = await resposta.json();
        if (resultado && resultado.address) {
            const bairro = resultado.address.suburb || resultado.address.neighbourhood || resultado.address.village || resultado.address.commercial;
            const cidade = resultado.address.city || resultado.address.town || resultado.address.municipality;
            if (bairro && cidade) return bairro + ', ' + cidade;
            if (bairro) return bairro;
        }
        return null;
    } catch (e) { return null; }
}

function processarDadosPrevisao(listaCompleta) {
    const filtrados = [];
    const datasVistas = [];
    const listaComplete = listaCompleta || [];
    listaComplete.forEach(item => {
        const dataTexto = item.dt_txt.split(' ')[0];
        if (!datasVistas.includes(dataTexto)) {
            datasVistas.push(dataTexto);
            filtrados.push(item);
        }
    });
    return filtrados.slice(0, 5);
}

function atualizarLabelsAbas(dadosDias) {
    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    document.getElementById('aba0').innerText = 'Hoje';
    document.getElementById('aba1').innerText = 'Amanhã';
    for (let i = 2; i < 5; i++) {
        if (dadosDias[i]) {
            const dataObjeto = new Date(dadosDias[i].dt * 1000);
            document.getElementById('aba' + i).innerText = diasSemana[dataObjeto.getDay()];
        }
    }
}

function mudarAba(indice) {
    if (!dadosPrevisao[indice]) return;
    abaAtual = indice;
    for (let i = 0; i < 5; i++) {
        document.getElementById('aba' + i).classList.remove('ativa');
    }
    document.getElementById('aba' + indice).classList.add('ativa');
    renderizarPainelDia(dadosPrevisao[indice]);
}

function renderizarPainelDia(pontoClima) {
    const ventoVelocidade = Math.round(pontoClima.wind.speed * 3.6);
    const ventoRajada = pontoClima.wind.gust ? Math.round(pontoClima.wind.gust * 3.6) : Math.round(pontoClima.wind.speed * 1.2 * 3.6);
    const chuvaProb = pontoClima.pop ? Math.round(pontoClima.pop * 100) : 0;
    const temp = Math.round(pontoClima.main.temp);
    const umidade = pontoClima.main.humidity;
    const nuvens = pontoClima.clouds.all;
    const graus = pontoClima.wind.deg;
    let direcao = '↓ N';
    if (graus > 22.5 && graus <= 67.5) direcao = '↙ NE';
    else if (graus > 67.5 && graus <= 112.5) direcao = '← L';
    else if (graus > 112.5 && graus <= 157.5) direcao = '↖ SE';
    else if (graus > 157.5 && graus <= 202.5) direcao = '↑ S';
    else if (graus > 202.5 && graus <= 247.5) direcao = '↗ SO';
    else if (graus > 247.5 && graus <= 292.5) direcao = '→ O';
    else if (graus > 292.5 && graus <= 337.5) direcao = '↘ NO';

    document.getElementById('valorVento').innerText = ventoVelocidade + ' km/h';
    document.getElementById('valorRajada').innerText = ventoRajada + ' km/h';
    document.getElementById('valorDirecao').innerText = direcao;
    document.getElementById('valorTemp').innerText = temp + ' °C';
    document.getElementById('valorUmidade').innerText = umidade + ' %';
    document.getElementById('valorChuva').innerText = chuvaProb + ' %';
    document.getElementById('valorNuvens').innerText = nuvens + ' %';

    const elVento = document.getElementById('valorVento');
    const elRajada = document.getElementById('valorRajada');
    const elChuva = document.getElementById('valorChuva');
    const statusBox = document.getElementById('statusVoo');
    const statusTexto = document.getElementById('textoStatus');

    elVento.className = 'valor-dados ' + (ventoVelocidade > 25 ? 'perigo' : (ventoVelocidade > 15 ? 'atencao' : 'bom'));
    elRajada.className = 'valor-dados ' + (ventoRajada > 35 ? 'perigo' : (ventoRajada > 22 ? 'atencao' : 'bom'));
    elChuva.className = 'valor-dados ' + (chuvaProb > 50 ? 'perigo' : (chuvaProb > 20 ? 'atencao' : 'bom'));

    if (ventoVelocidade > 25 || ventoRajada > 35 || chuvaProb > 50) {
        statusBox.style.backgroundColor = '#dc3545';
        statusBox.style.color = '#fff';
        statusTexto.innerText = 'Condições desfavoráveis para voo';
    } else if (ventoVelocidade > 15 || ventoRajada > 22 || chuvaProb > 20) {
        statusBox.style.backgroundColor = '#ffc107';
        statusBox.style.color = '#000';
        statusTexto.innerText = 'Voo com cautela / atenção';
    } else {
        statusBox.style.backgroundColor = '#28a745';
        statusBox.style.color = '#fff';
        statusTexto.innerText = 'Boas condições para voo';
    }
}

function inicializarInterfaceCompleta(dadosGlobais, nomeLugarCustomizado) {
    const nomeFinal = nomeLugarCustomizado || (dadosGlobais.city.name + ', ' + dadosGlobais.city.country);
    document.getElementById('nomeLocal').innerText = 'Local: ' + nomeFinal;
    dadosPrevisao = processarDadosPrevisao(dadosGlobais.list);
    atualizarLabelsAbas(dadosPrevisao);
    mudarAba(0);
    if (dadosGlobais.city.coord) inicializarMapa(dadosGlobais.city.coord.lat, dadosGlobais.city.coord.lon);
}

async function buscarPorCidade() {
    const cidade = document.getElementById('campoCidade').value.trim();
    if (!cidade) return alert('Por favor, digite o nome de uma cidade.');
    document.getElementById('textoStatus').innerText = '⏳ BUSCANDO PREVISÃO...';
    try {
        // Correção no endpoint da API de previsão (5 dias / 3 horas) do OpenWeather
        var url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(cidade)}&appid=${API_KEY}&units=metric&lang=pt_br`;
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error('Cidade não encontrada.');
        const dados = await resposta.json(); 
        const localExato = await descobrirBairroExato(dados.city.coord.lat, dados.city.coord.lon);
        inicializarInterfaceCompleta(dados, localExato);
    } catch (erro) {
        alert(erro.message);
        document.getElementById('textoStatus').innerText = '❌ ERRO NA CONSULTA';
        document.getElementById('statusVoo').style.backgroundColor = '#dc3545';
        document.getElementById('statusVoo').style.color = '#fff';
    }
}

function buscarPorGPS() {
    if (!navigator.geolocation) return alert('Sem suporte a GPS.');
    document.getElementById('textoStatus').innerText = '⏳ OBTENDO GPS...';
    navigator.geolocation.getCurrentPosition(async (posicao) => {
        try {
            const lat = posicao.coords.latitude;
            const lon = posicao.coords.longitude;
            const localExato = await descobrirBairroExato(lat, lon);
            // Correção no endpoint por Coordenadas (forecast)
            var url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=pt_br`;
            const resposta = await fetch(url);
            const dados = await resposta.json(); 
            inicializarInterfaceCompleta(dados, localExato);
        } catch (erro) {
            document.getElementById('textoStatus').innerText = '❌ ERRO NA CONSULTA';
            document.getElementById('statusVoo').style.backgroundColor = '#dc3545';
            document.getElementById('statusVoo').style.color = '#fff';
        }
    }, () => {
        document.getElementById('textoStatus').innerText = '⚪ AGUARDANDO DADOS (GPS RECUSADO)';
    }, { enableHighAccuracy: true, timeout: 10000 });
}

if ('serviceWorker' in navigator) {
    var blob = new Blob(['self.addEventListener("fetch", function(e){})'], {type: 'text/javascript'});
    var urlSW = URL.createObjectURL(blob);
    navigator.serviceWorker.register(urlSW).catch(function(err) { console.log(err); });
}

window.onload = function() { 
    inicializarMapa(); 
    buscarPorGPS(); 
};
