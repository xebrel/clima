const API_KEY = '87a13cf2373f492ad3f28c6961c75223'; 
let mapa = null;
let marcador = null;
let dadosPrevisao = []; 
let abaAtual = 0;
let fusoHorarioSegundos = 0;

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

// Converte um timestamp UTC em string YYYY-MM-DD ajustada ao fuso horário local da cidade pesquisada
function obterDataLocalCidade(dtTimestamp, offsetSegundos) {
    const dataLocal = new Date((dtTimestamp + offsetSegundos) * 1000);
    const ano = dataLocal.getUTCFullYear();
    const mes = String(dataLocal.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(dataLocal.getUTCDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function processarDadosPrevisao(listaCompleta, offsetSegundos) {
    const lista = listaCompleta || [];
    const resultado = [];

    // 1. Descobre qual é a data de HOJE no fuso exato da cidade pesquisada
    const agoraUTC = Math.floor(Date.now() / 1000);
    const dataHojeStr = obterDataLocalCidade(agoraUTC, offsetSegundos);

    // 2. Monta em ordem matemática exata as 5 datas consecutivas (Hoje, +1 dia, +2 dias, +3 dias, +4 dias)
    const datasDesejadas = [];
    const baseDate = new Date(`${dataHojeStr}T00:00:00Z`);

    for (let i = 0; i < 5; i++) {
        const d = new Date(baseDate.getTime() + (i * 24 * 60 * 60 * 1000));
        const ano = d.getUTCFullYear();
        const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dia = String(d.getUTCDate()).padStart(2, '0');
        datasDesejadas.push(`${ano}-${mes}-${dia}`);
    }

    // 3. Seleciona o ponto ideal de previsão para cada um dos 5 dias
    datasDesejadas.forEach((dataTarget, index) => {
        const itensDoDia = lista.filter(item => {
            return obterDataLocalCidade(item.dt, offsetSegundos) === dataTarget;
        });

        if (itensDoDia.length > 0) {
            if (index === 0) {
                // HOJE: Pega o bloco mais próximo do momento atual
                resultado.push(itensDoDia[0]);
            } else {
                // DIAS SEGUINTES: Busca o horário diurno relevante para o voo (12h - 15h)
                const pontoMeioDia = itensDoDia.find(item => {
                    const horaLocal = new Date((item.dt + offsetSegundos) * 1000).getUTCHours();
                    return horaLocal >= 12 && horaLocal <= 15;
                });

                if (pontoMeioDia) {
                    resultado.push(pontoMeioDia);
                } else {
                    const indiceMeio = Math.floor(itensDoDia.length / 2);
                    resultado.push(itensDoDia[indiceMeio]);
                }
            }
        }
    });

    return resultado;
}

function atualizarLabelsAbas(dadosDias, offsetSegundos) {
    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    
    const elAba0 = document.getElementById('aba0');
    const elAba1 = document.getElementById('aba1');
    if (elAba0) elAba0.innerText = 'Hoje';
    if (elAba1) elAba1.innerText = 'Amanhã';

    // Garante os rótulos de dias da semana consecutivos baseados no relógio local
    const agoraUTC = Math.floor(Date.now() / 1000);
    const dataHojeStr = obterDataLocalCidade(agoraUTC, offsetSegundos);
    const baseDate = new Date(`${dataHojeStr}T00:00:00Z`);

    for (let i = 2; i < 5; i++) {
        const d = new Date(baseDate.getTime() + (i * 24 * 60 * 60 * 1000));
        const diaSemanaIndice = d.getUTCDay();
        
        const elementoAba = document.getElementById('aba' + i);
        if (elementoAba) {
            elementoAba.innerText = diasSemana[diaSemanaIndice];
        }
    }
}

function mudarAba(indice) {
    if (!dadosPrevisao[indice]) return;
    abaAtual = indice;
    for (let i = 0; i < 5; i++) {
        const elAba = document.getElementById('aba' + i);
        if (elAba) elAba.classList.remove('ativa');
    }
    const abaSelecionada = document.getElementById('aba' + indice);
    if (abaSelecionada) abaSelecionada.classList.add('ativa');
    
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

    // Leitura da condição climática do momento
    const climaInfo = (pontoClima.weather && pontoClima.weather[0]) ? pontoClima.weather[0] : { main: '', description: '' };
    const condicaoClima = climaInfo.description ? (climaInfo.description.charAt(0).toUpperCase() + climaInfo.description.slice(1)) : 'N/A';
    const categoriaClima = climaInfo.main.toLowerCase();

    // Verificação se há ocorrência de chuva (Rain, Drizzle ou Thunderstorm)
    const estaChovendo = categoriaClima.includes('rain') || categoriaClima.includes('drizzle') || categoriaClima.includes('thunderstorm');

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

    const elCondicao = document.getElementById('valorCondicao');
    if (elCondicao) {
        elCondicao.innerText = condicaoClima;
    }

    const elVento = document.getElementById('valorVento');
    const elRajada = document.getElementById('valorRajada');
    const elChuva = document.getElementById('valorChuva');
    const statusBox = document.getElementById('statusVoo');
    const statusTexto = document.getElementById('textoStatus');

    elVento.className = 'valor-dados ' + (ventoVelocidade > 25 ? 'perigo' : (ventoVelocidade > 15 ? 'atencao' : 'bom'));
    elRajada.className = 'valor-dados ' + (ventoRajada > 35 ? 'perigo' : (ventoRajada > 22 ? 'atencao' : 'bom'));
    elChuva.className = 'valor-dados ' + (estaChovendo || chuvaProb > 50 ? 'perigo' : (chuvaProb > 20 ? 'atencao' : 'bom'));

    // Lógica do alerta de voo (Qualquer ocorrência de chuva ativa alerta de desfavorável)
    if (estaChovendo || ventoVelocidade > 25 || ventoRajada > 35 || chuvaProb > 50) {
        statusBox.style.backgroundColor = '#dc3545';
        statusBox.style.color = '#fff';
        if (estaChovendo) {
            statusTexto.innerText = `Desfavorável para voo: ${condicaoClima}`;
        } else {
            statusTexto.innerText = 'Condições desfavoráveis para voo';
        }
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
    
    fusoHorarioSegundos = dadosGlobais.city.timezone || 0;

    dadosPrevisao = processarDadosPrevisao(dadosGlobais.list, fusoHorarioSegundos);
    atualizarLabelsAbas(dadosPrevisao, fusoHorarioSegundos);
    mudarAba(0);
    if (dadosGlobais.city.coord) inicializarMapa(dadosGlobais.city.coord.lat, dadosGlobais.city.coord.lon);
}

async function buscarPorCidade() {
    const cidade = document.getElementById('campoCidade').value.trim();
    if (!cidade) return alert('Por favor, digite o nome de uma cidade.');
    document.getElementById('textoStatus').innerText = '⏳ BUSCANDO PREVISÃO...';
    try {
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
    navigator.serviceWorker.register('sw.js')
        .then(function(reg) {
            console.log('Service Worker registrado com sucesso para o escopo:', reg.scope);
        })
        .catch(function(err) {
            console.warn('Erro ao registrar o Service Worker:', err);
        });
}

window.onload = function() { 
    inicializarMapa(); 
    buscarPorGPS(); 
};
