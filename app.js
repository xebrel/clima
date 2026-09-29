let mapa = null;
let marcador = null;
let dadosPrevisaoPorDia = []; // Lista agrupada por dia [ { data, horas: [...] } ]
let abaAtual = 0;
let horaSelecionadaIndex = 0;
let altitudeAtual = 80; // 10, 80 ou 120 metros
let indiceKpAtual = null;

// Tabela WMO Weather interpretation codes (Open-Meteo)
const WMO_CODES = {
    0: { desc: 'Céu limpo', icon: '☀️', chovendo: false },
    1: { desc: 'Principalmente limpo', icon: '🌤️', chovendo: false },
    2: { desc: 'Parcialmente nublado', icon: '⛅', chovendo: false },
    3: { desc: 'Encoberto', icon: '☁️', chovendo: false },
    45: { desc: 'Neblina', icon: '🌫️', chovendo: false },
    48: { desc: 'Nevoeiro depositando geada', icon: '🌫️', chovendo: false },
    51: { desc: 'Garoa leve', icon: '🌦️', chovendo: true },
    53: { desc: 'Garoa moderada', icon: '🌦️', chovendo: true },
    55: { desc: 'Garoa densa', icon: '🌧️', chovendo: true },
    61: { desc: 'Chuva fraca', icon: '🌧️', chovendo: true },
    63: { desc: 'Chuva moderada', icon: '🌧️', chovendo: true },
    65: { desc: 'Chuva forte', icon: '🌧️', chovendo: true },
    71: { desc: 'Neve fraca', icon: '🌨️', chovendo: true },
    73: { desc: 'Neve moderada', icon: '🌨️', chovendo: true },
    75: { desc: 'Neve intensa', icon: '❄️', chovendo: true },
    80: { desc: 'Pancadas de chuva fracas', icon: '🌦️', chovendo: true },
    81: { desc: 'Pancadas de chuva moderadas', icon: '🌧️', chovendo: true },
    82: { desc: 'Pancadas de chuva violentas', icon: '⛈️', chovendo: true },
    95: { desc: 'Tempestade com trovões', icon: '⛈️', chovendo: true },
    96: { desc: 'Tempestade com granizo leve', icon: '⛈️', chovendo: true },
    99: { desc: 'Tempestade severa com granizo', icon: '⛈️', chovendo: true }
};

function traduzirWmo(code) {
    return WMO_CODES[code] || { desc: 'Instável', icon: '⛅', chovendo: false };
}

function inicializarMapa(lat, lon) {
    if (typeof L === 'undefined') return;
    const latitude = lat || -27.5954;
    const longitude = lon || -48.5480;
    if (!mapa) {
        mapa = L.map('mapa', { zoomControl: true }).setView([latitude, longitude], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
        marcador = L.marker([latitude, longitude]).addTo(mapa);
    } else {
        mapa.setView([latitude, longitude], 14);
        marcador.setLatLng([latitude, longitude]);
    }
}

async function buscarIndiceKpSolar() {
    try {
        const resposta = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
        if (!resposta.ok) return null;
        const dados = await resposta.json();
        if (dados && dados.length > 1) {
            const ultimoRegistro = dados[dados.length - 1];
            // Formato: [time_tag, Kp, a_running, station_count]
            const kp = parseFloat(ultimoRegistro[1]);
            return isNaN(kp) ? null : kp;
        }
    } catch (e) {
        console.warn('Erro ao obter KP solar:', e);
    }
    return null;
}

async function descobrirBairroExato(lat, lon) {
    try {
        const urlGeo = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
        const resposta = await fetch(urlGeo, { headers: { 'Accept-Language': 'pt-BR' } });
        if (!resposta.ok) return null;
        const resultado = await resposta.json();
        if (resultado && resultado.address) {
            const bairro = resultado.address.suburb || resultado.address.neighbourhood || resultado.address.village || resultado.address.commercial;
            const cidade = resultado.address.city || resultado.address.town || resultado.address.municipality;
            if (bairro && cidade) return `${bairro}, ${cidade}`;
            if (bairro) return bairro;
            if (cidade) return cidade;
        }
    } catch (e) { }
    return null;
}

function agruparDadosOpenMeteo(hourly) {
    const grupos = {};
    const totalHoras = hourly.time.length;

    for (let i = 0; i < totalHoras; i++) {
        const isoTime = hourly.time[i]; // formato "YYYY-MM-DDTHH:mm"
        const [dataStr, horaStr] = isoTime.split('T');

        if (!grupos[dataStr]) {
            grupos[dataStr] = [];
        }

        grupos[dataStr].push({
            horaCompleta: isoTime,
            hora: horaStr,
            temp: Math.round(hourly.temperature_2m[i]),
            umidade: hourly.relative_humidity_2m[i],
            probChuva: hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0,
            nuvens: hourly.cloud_cover[i],
            visibilidade: hourly.visibility ? Math.round(hourly.visibility[i] / 1000) : 10, // em km
            vento10m: Math.round(hourly.wind_speed_10m[i]),
            vento80m: Math.round(hourly.wind_speed_80m[i]),
            vento120m: Math.round(hourly.wind_speed_120m[i]),
            rajada: Math.round(hourly.wind_gusts_10m[i]),
            graus10m: hourly.wind_direction_10m[i],
            graus120m: hourly.wind_direction_120m[i],
            weatherCode: hourly.weather_code[i]
        });
    }

    const resultadoDias = Object.keys(grupos).slice(0, 5).map(data => {
        return {
            data: data,
            horas: grupos[data]
        };
    });

    return resultadoDias;
}

function atualizarLabelsAbas(dias) {
    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    
    document.getElementById('aba0').innerText = 'Hoje';
    if (dias.length > 1) {
        document.getElementById('aba1').innerText = 'Amanhã';
    }

    for (let i = 2; i < 5; i++) {
        const elAba = document.getElementById('aba' + i);
        if (dias[i]) {
            const dataObj = new Date(`${dias[i].data}T12:00:00`);
            elAba.innerText = diasSemana[dataObj.getDay()];
            elAba.style.display = 'block';
        } else if (elAba) {
            elAba.style.display = 'none';
        }
    }
}

function mudarAltitude(alt) {
    altitudeAtual = alt;
    document.getElementById('btnAlt10').classList.toggle('ativa', alt === 10);
    document.getElementById('btnAlt80').classList.toggle('ativa', alt === 80);
    document.getElementById('btnAlt120').classList.toggle('ativa', alt === 120);
    document.getElementById('labelAltitudeVento').innerText = alt + 'm';

    renderizarCarrosselHoras();
    renderizarPainelHoraAtual();
}

function mudarAba(indice) {
    if (!dadosPrevisaoPorDia[indice]) return;
    abaAtual = indice;
    for (let i = 0; i < 5; i++) {
        const elAba = document.getElementById('aba' + i);
        if (elAba) elAba.classList.toggle('ativa', i === indice);
    }

    // Se for o dia de Hoje (0), foca na hora mais próxima do relógio atual
    if (indice === 0) {
        const agora = new Date();
        const horaAtualNum = agora.getHours();
        const listaHoras = dadosPrevisaoPorDia[0].horas;
        
        let indiceMaisProximo = 0;
        let menorDiferenca = 999;
        listaHoras.forEach((h, idx) => {
            const horaH = parseInt(h.hora.split(':')[0], 10);
            const dif = Math.abs(horaH - horaAtualNum);
            if (dif < menorDiferenca) {
                menorDiferenca = dif;
                indiceMaisProximo = idx;
            }
        });
        horaSelecionadaIndex = indiceMaisProximo;
    } else {
        // Para dias futuros, seleciona por padrão 12h ou 14h (ponto alto do dia)
        const listaHoras = dadosPrevisaoPorDia[indice].horas;
        const indiceMeioDia = listaHoras.findIndex(h => {
            const horaH = parseInt(h.hora.split(':')[0], 10);
            return horaH >= 12 && horaH <= 15;
        });
        horaSelecionadaIndex = indiceMeioDia >= 0 ? indiceMeioDia : Math.floor(listaHoras.length / 2);
    }

    renderizarCarrosselHoras();
    renderizarPainelHoraAtual();
}

function renderizarCarrosselHoras() {
    const container = document.getElementById('horasScroll');
    container.innerHTML = '';
    const diaObj = dadosPrevisaoPorDia[abaAtual];
    if (!diaObj || !diaObj.horas) return;

    diaObj.horas.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'hora-card' + (index === horaSelecionadaIndex ? ' ativa' : '');
        
        const infoWmo = traduzirWmo(item.weatherCode);
        const ventoEscolhido = altitudeAtual === 10 ? item.vento10m : (altitudeAtual === 80 ? item.vento80m : item.vento120m);
        const corVento = ventoEscolhido > 32 ? '#f75a68' : (ventoEscolhido > 20 ? '#ffc107' : '#00b37e');

        card.innerHTML = `
            <div class="hora-titulo">${item.hora}</div>
            <div class="hora-clima-icon">${infoWmo.icon}</div>
            <div class="hora-vento" style="color: ${corVento}">${ventoEscolhido} km/h</div>
        `;

        card.onclick = () => {
            horaSelecionadaIndex = index;
            document.querySelectorAll('.hora-card').forEach((el, idx) => {
                el.classList.toggle('ativa', idx === index);
            });
            renderizarPainelHoraAtual();
        };

        container.appendChild(card);
    });

    // Auto-scroll para manter a hora selecionada visível
    const ativaEl = container.children[horaSelecionadaIndex];
    if (ativaEl) {
        ativaEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function converterGrausParaDirecao(graus) {
    if (graus > 22.5 && graus <= 67.5) return '↙ NE';
    if (graus > 67.5 && graus <= 112.5) return '← L';
    if (graus > 112.5 && graus <= 157.5) return '↖ SE';
    if (graus > 157.5 && graus <= 202.5) return '↑ S';
    if (graus > 202.5 && graus <= 247.5) return '↗ SO';
    if (graus > 247.5 && graus <= 292.5) return '→ O';
    if (graus > 292.5 && graus <= 337.5) return '↘ NO';
    return '↓ N';
}

function renderizarPainelHoraAtual() {
    const diaObj = dadosPrevisaoPorDia[abaAtual];
    if (!diaObj || !diaObj.horas || !diaObj.horas[horaSelecionadaIndex]) return;

    const ponto = diaObj.horas[horaSelecionadaIndex];
    const infoWmo = traduzirWmo(ponto.weatherCode);

    document.getElementById('labelHoraSelecionada').innerText = ponto.hora;

    // Vento na altitude selecionada
    const ventoVelocidade = altitudeAtual === 10 ? ponto.vento10m : (altitudeAtual === 80 ? ponto.vento80m : ponto.vento120m);
    const ventoRajada = ponto.rajada;
    const graus = altitudeAtual === 120 ? ponto.graus120m : ponto.graus10m;
    const direcao = converterGrausParaDirecao(graus);

    document.getElementById('valorVento').innerText = `${ventoVelocidade} km/h`;
    document.getElementById('valorRajada').innerText = `${ventoRajada} km/h`;
    document.getElementById('valorDirecao').innerText = direcao;

    // Condições atmosféricas
    document.getElementById('valorCondicao').innerText = `${infoWmo.icon} ${infoWmo.desc}`;
    document.getElementById('valorTemp').innerText = `${ponto.temp} °C`;
    document.getElementById('valorUmidade').innerText = `${ponto.umidade} %`;
    document.getElementById('valorChuva').innerText = `${ponto.probChuva} %`;
    document.getElementById('valorNuvens').innerText = `${ponto.nuvens} %`;
    document.getElementById('valorVisibilidade').innerText = `${ponto.visibilidade} km`;

    // Índice KP Solar
    const elKp = document.getElementById('valorKp');
    if (indiceKpAtual !== null) {
        elKp.innerText = `KP ${indiceKpAtual.toFixed(1)} (${indiceKpAtual >= 5 ? '⚠️ Tormenta Solar' : (indiceKpAtual >= 4 ? 'Atenção Bússola' : 'Estável')})`;
        elKp.className = 'valor-dados ' + (indiceKpAtual >= 5 ? 'perigo' : (indiceKpAtual >= 4 ? 'atencao' : 'bom'));
    } else {
        elKp.innerText = 'KP -- (Sem sinal)';
        elKp.className = 'valor-dados bom';
    }

    // Cores de criticidade
    const elVento = document.getElementById('valorVento');
    const elRajada = document.getElementById('valorRajada');
    const elChuva = document.getElementById('valorChuva');
    const elVisibilidade = document.getElementById('valorVisibilidade');
    const statusBox = document.getElementById('statusVoo');
    const statusTexto = document.getElementById('textoStatus');

    elVento.className = 'valor-dados ' + (ventoVelocidade > 32 ? 'perigo' : (ventoVelocidade > 20 ? 'atencao' : 'bom'));
    elRajada.className = 'valor-dados ' + (ventoRajada > 40 ? 'perigo' : (ventoRajada > 28 ? 'atencao' : 'bom'));
    elChuva.className = 'valor-dados ' + (infoWmo.chovendo || ponto.probChuva > 50 ? 'perigo' : (ponto.probChuva > 25 ? 'atencao' : 'bom'));
    elVisibilidade.className = 'valor-dados ' + (ponto.visibilidade < 3 ? 'perigo' : (ponto.visibilidade < 5 ? 'atencao' : 'bom'));

    // Lógica do Status Geral de Voo de Drone
    if (infoWmo.chovendo) {
        statusBox.style.backgroundColor = '#dc3545';
        statusBox.style.color = '#fff';
        statusTexto.innerText = `🛑 Voo Desfavorável: ${infoWmo.desc}`;
    } else if (ventoVelocidade > 32 || ventoRajada > 40) {
        statusBox.style.backgroundColor = '#dc3545';
        statusBox.style.color = '#fff';
        statusTexto.innerText = `🛑 Vento perigoso (${ventoVelocidade} km/h) a ${altitudeAtual}m!`;
    } else if (ponto.visibilidade < 3) {
        statusBox.style.backgroundColor = '#dc3545';
        statusBox.style.color = '#fff';
        statusTexto.innerText = '🛑 Baixa Visibilidade (< 3km) para VLOS';
    } else if (indiceKpAtual !== null && indiceKpAtual >= 5) {
        statusBox.style.backgroundColor = '#dc3545';
        statusBox.style.color = '#fff';
        statusTexto.innerText = '🛑 Tempestade Solar Severa (Risco de perda GPS)';
    } else if (ventoVelocidade > 20 || ventoRajada > 28 || ponto.probChuva > 25 || ponto.visibilidade < 5 || (indiceKpAtual !== null && indiceKpAtual >= 4)) {
        statusBox.style.backgroundColor = '#ffc107';
        statusBox.style.color = '#000';
        statusTexto.innerText = '⚠️ Atenção: Voe com Cautela';
    } else {
        statusBox.style.backgroundColor = '#28a745';
        statusBox.style.color = '#fff';
        statusTexto.innerText = '✅ Condições Excelentes para Voo';
    }
}

async function carregarPrevisaoOpenMeteo(lat, lon, nomeLocal) {
    try {
        document.getElementById('textoStatus').innerText = '⏳ ATUALIZANDO DADOS METEOROLÓGICOS...';
        
        // Chamada simultânea à Open-Meteo e à NOAA KP
        const urlMeteo = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,cloud_cover,visibility,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_direction_10m,wind_direction_120m,wind_gusts_10m&wind_speed_unit=kmh&timezone=auto&forecast_days=6`;

        const [resMeteo, kp] = await Promise.all([
            fetch(urlMeteo).then(r => r.json()),
            buscarIndiceKpSolar()
        ]);

        indiceKpAtual = kp;

        if (!resMeteo || !resMeteo.hourly) {
            throw new Error('Não foi possível obter a previsão.');
        }

        dadosPrevisaoPorDia = agruparDadosOpenMeteo(resMeteo.hourly);
        document.getElementById('nomeLocal').innerText = 'Local: ' + nomeLocal;

        atualizarLabelsAbas(dadosPrevisaoPorDia);
        inicializarMapa(lat, lon);
        mudarAba(0);

    } catch (erro) {
        console.error(erro);
        alert('Erro ao carregar previsão: ' + erro.message);
        document.getElementById('textoStatus').innerText = '❌ ERRO NA CONSULTA';
        document.getElementById('statusVoo').style.backgroundColor = '#dc3545';
        document.getElementById('statusVoo').style.color = '#fff';
    }
}

async function buscarPorCidade() {
    const cidade = document.getElementById('campoCidade').value.trim();
    if (!cidade) return alert('Por favor, digite o nome de uma cidade.');
    document.getElementById('textoStatus').innerText = '⏳ LOCALIZANDO CIDADE...';

    try {
        const urlGeo = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt&format=json`;
        const resGeo = await fetch(urlGeo).then(r => r.json());

        if (!resGeo || !resGeo.results || resGeo.results.length === 0) {
            throw new Error('Cidade não encontrada.');
        }

        const lugar = resGeo.results[0];
        const nomeFormatado = `${lugar.name}${lugar.admin1 ? ', ' + lugar.admin1 : ''} - ${lugar.country || ''}`;

        await carregarPrevisaoOpenMeteo(lugar.latitude, lugar.longitude, nomeFormatado);
    } catch (e) {
        alert(e.message);
        document.getElementById('textoStatus').innerText = '❌ CIDADE NÃO ENCONTRADA';
    }
}

function buscarPorGPS() {
    if (!navigator.geolocation) return alert('Sem suporte a GPS no seu navegador.');
    document.getElementById('textoStatus').innerText = '⏳ OBTENDO GPS DE ALTA PRECISÃO...';

    navigator.geolocation.getCurrentPosition(async (posicao) => {
        try {
            const lat = posicao.coords.latitude;
            const lon = posicao.coords.longitude;
            const bairro = await descobrirBairroExato(lat, lon);
            const nomeFinal = bairro || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            await carregarPrevisaoOpenMeteo(lat, lon, nomeFinal);
        } catch (erro) {
            console.error(erro);
            document.getElementById('textoStatus').innerText = '❌ ERRO AO OBTER LOCAL';
        }
    }, (err) => {
        console.warn('GPS negado:', err);
        document.getElementById('textoStatus').innerText = '⚪ AGUARDANDO CIDADE (GPS RECUSADO)';
        // Carrega uma cidade padrão caso o GPS seja negado
        buscarPorCidadePadrao();
    }, { enableHighAccuracy: true, timeout: 10000 });
}

function buscarPorCidadePadrao() {
    // Cidade padrão inicial caso não autorize GPS imediatamente (ex: Florianópolis)
    carregarPrevisaoOpenMeteo(-27.5954, -48.5480, 'Florianópolis, Santa Catarina');
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('SW registrado com sucesso:', reg.scope))
        .catch(err => console.warn('Erro ao registrar SW:', err));
}

window.onload = function() {
    inicializarMapa();
    buscarPorGPS();
};
