/* ============================================================
   Skyglass — 3D Weather
   Three.js scene + Open-Meteo API + UI wiring
   ============================================================ */

/* ---------- WMO weather code → human text + scene key ---------- */
/* https://open-meteo.com/en/docs (WMO Weather interpretation codes) */
const WEATHER_CODES = {
  0:  { text: 'Clear sky',            icon: 'sun',       scene: 'clear'  },
  1:  { text: 'Mainly clear',         icon: 'sun-cloud', scene: 'clear'  },
  2:  { text: 'Partly cloudy',        icon: 'sun-cloud', scene: 'cloudy' },
  3:  { text: 'Overcast',             icon: 'cloud',     scene: 'cloudy' },
  45: { text: 'Foggy',                icon: 'fog',       scene: 'fog'    },
  48: { text: 'Depositing rime fog',  icon: 'fog',       scene: 'fog'    },
  51: { text: 'Light drizzle',        icon: 'rain',      scene: 'rain'   },
  53: { text: 'Moderate drizzle',     icon: 'rain',      scene: 'rain'   },
  55: { text: 'Dense drizzle',        icon: 'rain',      scene: 'rain'   },
  56: { text: 'Light freezing drizzle', icon: 'rain',    scene: 'rain'   },
  57: { text: 'Dense freezing drizzle', icon: 'rain',    scene: 'rain'   },
  61: { text: 'Slight rain',          icon: 'rain',      scene: 'rain'   },
  63: { text: 'Moderate rain',        icon: 'rain',      scene: 'rain'   },
  65: { text: 'Heavy rain',           icon: 'rain',      scene: 'rain'   },
  66: { text: 'Light freezing rain',  icon: 'rain',      scene: 'rain'   },
  67: { text: 'Heavy freezing rain',  icon: 'rain',      scene: 'rain'   },
  71: { text: 'Slight snow',          icon: 'snow',      scene: 'snow'   },
  73: { text: 'Moderate snow',        icon: 'snow',      scene: 'snow'   },
  75: { text: 'Heavy snow',           icon: 'snow',      scene: 'snow'   },
  77: { text: 'Snow grains',          icon: 'snow',      scene: 'snow'   },
  80: { text: 'Slight rain showers',  icon: 'rain',      scene: 'rain'   },
  81: { text: 'Moderate rain showers',icon: 'rain',      scene: 'rain'   },
  82: { text: 'Violent rain showers', icon: 'rain',      scene: 'rain'   },
  85: { text: 'Slight snow showers',  icon: 'snow',      scene: 'snow'   },
  86: { text: 'Heavy snow showers',   icon: 'snow',      scene: 'snow'   },
  95: { text: 'Thunderstorm',         icon: 'bolt',      scene: 'storm'  },
  96: { text: 'Thunderstorm w/ hail', icon: 'bolt',      scene: 'storm'  },
  99: { text: 'Thunderstorm w/ heavy hail', icon: 'bolt', scene: 'storm'  },
};

const DEFAULT_SCENE = 'clear';
const DEFAULT_CITY = 'London';

/* ============================================================
   Three.js — 3D scene
   ============================================================ */
const Scene3D = (() => {
  let renderer, scene, camera, clock;
  let currentGroup = null;
  let currentSceneKey = DEFAULT_SCENE;
  let fadeStart = 0;
  let fadeFrom = null;
  let resizeHandler;

  function init() {
    const canvas = document.getElementById('bg-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1024, 30, 90);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 0, 30);

    clock = new THREE.Clock();

    // soft ambient + key light
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(5, 5, 10);
    scene.add(key);

    resizeHandler = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', resizeHandler);

    setScene(DEFAULT_SCENE);
    animate();
  }

  function setScene(key) {
    if (!renderer) return; // 3D was disabled (no WebGL or missing THREE); silently no-op
    if (key === currentSceneKey && currentGroup) return;
    const builder = builders[key] || builders[DEFAULT_SCENE];
    const newGroup = builder();

    // fade transition: keep old group in scene, fade out, then remove
    if (currentGroup) {
      fadeFrom = currentGroup;
      fadeStart = clock.getElapsedTime();
      fadeFrom.userData.fadingOut = true;
    }
    currentGroup = newGroup;
    scene.add(newGroup);
    currentSceneKey = key;
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    // animate current group
    if (currentGroup && currentGroup.userData.tick) {
      currentGroup.userData.tick(dt, elapsed);
    }

    // fade transition
    if (fadeFrom) {
      const t = (elapsed - fadeStart) / 1.0; // 1s fade
      if (t >= 1) {
        scene.remove(fadeFrom);
        disposeGroup(fadeFrom);
        fadeFrom = null;
      } else {
        fadeOutGroup(fadeFrom, t);
      }
    }

    renderer.render(scene, camera);
  }

  function fadeOutGroup(group, t) {
    group.traverse(obj => {
      if (obj.material) {
        const m = obj.material;
        if (m.opacity === undefined) return;
        if (!m.transparent) m.transparent = true;
        if (m.userData._originalOpacity === undefined) m.userData._originalOpacity = m.opacity;
        m.opacity = m.userData._originalOpacity * (1 - t);
      }
    });
  }

  function disposeGroup(group) {
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  /* ---------- Scene builders ---------- */

  const builders = {
    /* CLEAR: glowing sun + drifting clouds */
    clear: () => {
      const group = new THREE.Group();

      // sun
      const sunGeo = new THREE.SphereGeometry(2.5, 32, 32);
      const sunMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 1 });
      const sun = new THREE.Mesh(sunGeo, sunMat);
      sun.position.set(8, 6, -10);
      group.add(sun);

      // sun glow
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xfde68a,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide,
      });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 32), glowMat);
      glow.position.copy(sun.position);
      group.add(glow);

      // clouds
      const clouds = [];
      for (let i = 0; i < 6; i++) {
        const cloud = makeCloud();
        cloud.position.set(
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.2) * 10 + 2,
          -15 - Math.random() * 10
        );
        cloud.scale.setScalar(0.8 + Math.random() * 0.8);
        cloud.userData.speed = 0.1 + Math.random() * 0.2;
        cloud.userData.baseX = cloud.position.x;
        group.add(cloud);
        clouds.push(cloud);
      }

      group.userData.tick = (dt, elapsed) => {
        sun.rotation.y = elapsed * 0.2;
        glow.scale.setScalar(1 + Math.sin(elapsed * 1.5) * 0.08);
        clouds.forEach(c => {
          c.position.x = c.userData.baseX + Math.sin(elapsed * c.userData.speed) * 2;
        });
      };

      return group;
    },

    /* CLOUDY: many grey clouds, no sun */
    cloudy: () => {
      const group = new THREE.Group();
      const clouds = [];

      for (let i = 0; i < 14; i++) {
        const cloud = makeCloud(0x94a3b8, 0.9);
        cloud.position.set(
          (Math.random() - 0.5) * 50,
          (Math.random() - 0.5) * 18,
          -10 - Math.random() * 15
        );
        cloud.scale.setScalar(1 + Math.random() * 1.2);
        cloud.userData.speed = 0.05 + Math.random() * 0.15;
        cloud.userData.baseX = cloud.position.x;
        group.add(cloud);
        clouds.push(cloud);
      }

      group.userData.tick = (dt, elapsed) => {
        clouds.forEach(c => {
          c.position.x = c.userData.baseX + Math.sin(elapsed * c.userData.speed) * 3;
        });
      };

      return group;
    },

    /* FOG: layered translucent planes */
    fog: () => {
      const group = new THREE.Group();
      const planes = [];
      for (let i = 0; i < 8; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xcbd5e1,
          transparent: true,
          opacity: 0.15 + Math.random() * 0.15,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), mat);
        plane.position.set(
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 10,
          -10 - Math.random() * 20
        );
        plane.rotation.z = Math.random() * Math.PI;
        plane.userData.speed = 0.05 + Math.random() * 0.1;
        plane.userData.baseX = plane.position.x;
        group.add(plane);
        planes.push(plane);
      }

      group.userData.tick = (dt, elapsed) => {
        planes.forEach(p => {
          p.position.x = p.userData.baseX + Math.sin(elapsed * p.userData.speed) * 3;
        });
      };

      return group;
    },

    /* RAIN: dense raindrops + dark clouds */
    rain: () => {
      const group = new THREE.Group();

      // dark clouds
      const clouds = [];
      for (let i = 0; i < 5; i++) {
        const cloud = makeCloud(0x475569, 1);
        cloud.position.set(
          (Math.random() - 0.5) * 30,
          4 + Math.random() * 4,
          -10 - Math.random() * 5
        );
        cloud.scale.setScalar(1.2 + Math.random() * 0.8);
        group.add(cloud);
        clouds.push(cloud);
      }

      // rain — instanced lines
      const dropCount = 600;
      const dropGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(dropCount * 6);
      const velocities = new Float32Array(dropCount);
      for (let i = 0; i < dropCount; i++) {
        const x = (Math.random() - 0.5) * 60;
        const y = Math.random() * 40 - 20;
        const z = (Math.random() - 0.5) * 40 - 10;
        const len = 0.4 + Math.random() * 0.4;
        positions[i * 6 + 0] = x;
        positions[i * 6 + 1] = y;
        positions[i * 6 + 2] = z;
        positions[i * 6 + 3] = x;
        positions[i * 6 + 4] = y - len;
        positions[i * 6 + 5] = z;
        velocities[i] = 0.5 + Math.random() * 0.5;
      }
      dropGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const dropMat = new THREE.LineBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.6 });
      const drops = new THREE.LineSegments(dropGeo, dropMat);
      group.add(drops);

      group.userData.tick = (dt, elapsed) => {
        clouds.forEach(c => { c.position.x += dt * 0.3; if (c.position.x > 20) c.position.x = -20; });

        const pos = drops.geometry.attributes.position;
        for (let i = 0; i < dropCount; i++) {
          let y = pos.array[i * 6 + 1] - velocities[i];
          if (y < -20) y = 20;
          const dy = y - 0.5;
          pos.array[i * 6 + 1] = y;
          pos.array[i * 6 + 4] = dy;
        }
        pos.needsUpdate = true;
      };

      return group;
    },

    /* SNOW: gentle drifting snowflakes */
    snow: () => {
      const group = new THREE.Group();

      // light clouds
      const clouds = [];
      for (let i = 0; i < 4; i++) {
        const cloud = makeCloud(0xe2e8f0, 0.85);
        cloud.position.set(
          (Math.random() - 0.5) * 30,
          4 + Math.random() * 4,
          -10 - Math.random() * 5
        );
        cloud.scale.setScalar(1.2 + Math.random() * 0.8);
        group.add(cloud);
        clouds.push(cloud);
      }

      // snowflake sprite via Points
      const flakeCount = 400;
      const flakeGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(flakeCount * 3);
      const phases = new Float32Array(flakeCount);
      for (let i = 0; i < flakeCount; i++) {
        positions[i * 3 + 0] = (Math.random() - 0.5) * 60;
        positions[i * 3 + 1] = Math.random() * 40 - 20;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 5;
        phases[i] = Math.random() * Math.PI * 2;
      }
      flakeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // circular sprite texture
      const sparkCanvas = document.createElement('canvas');
      sparkCanvas.width = sparkCanvas.height = 32;
      const ctx = sparkCanvas.getContext('2d');
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(16, 16, 16, 0, Math.PI * 2);
      ctx.fill();
      const sprite = new THREE.CanvasTexture(sparkCanvas);

      const flakeMat = new THREE.PointsMaterial({
        size: 0.4,
        map: sprite,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const flakes = new THREE.Points(flakeGeo, flakeMat);
      group.add(flakes);

      group.userData.tick = (dt, elapsed) => {
        const pos = flakes.geometry.attributes.position;
        for (let i = 0; i < flakeCount; i++) {
          let y = pos.array[i * 3 + 1] - 0.05;
          if (y < -20) y = 20;
          pos.array[i * 3 + 1] = y;
          pos.array[i * 3 + 0] += Math.sin(elapsed + phases[i]) * 0.005;
        }
        pos.needsUpdate = true;
      };

      return group;
    },

    /* STORM: rain + lightning flash */
    storm: () => {
      const group = new THREE.Group();

      // dark clouds
      const clouds = [];
      for (let i = 0; i < 6; i++) {
        const cloud = makeCloud(0x1e293b, 1);
        cloud.position.set(
          (Math.random() - 0.5) * 30,
          4 + Math.random() * 4,
          -10 - Math.random() * 5
        );
        cloud.scale.setScalar(1.3 + Math.random() * 0.9);
        group.add(cloud);
        clouds.push(cloud);
      }

      // rain
      const dropCount = 700;
      const dropGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(dropCount * 6);
      const velocities = new Float32Array(dropCount);
      for (let i = 0; i < dropCount; i++) {
        const x = (Math.random() - 0.5) * 60;
        const y = Math.random() * 40 - 20;
        const z = (Math.random() - 0.5) * 40 - 10;
        const len = 0.5 + Math.random() * 0.5;
        positions[i * 6 + 0] = x;
        positions[i * 6 + 1] = y;
        positions[i * 6 + 2] = z;
        positions[i * 6 + 3] = x;
        positions[i * 6 + 4] = y - len;
        positions[i * 6 + 5] = z;
        velocities[i] = 0.7 + Math.random() * 0.6;
      }
      dropGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const dropMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.7 });
      const drops = new THREE.LineSegments(dropGeo, dropMat);
      group.add(drops);

      // lightning flash light
      const flash = new THREE.PointLight(0xffffff, 0, 100);
      flash.position.set(0, 5, -5);
      group.add(flash);

      let nextFlash = 1 + Math.random() * 3;
      let flashTime = 0;

      group.userData.tick = (dt, elapsed) => {
        clouds.forEach(c => { c.position.x += dt * 0.4; if (c.position.x > 20) c.position.x = -20; });

        const pos = drops.geometry.attributes.position;
        for (let i = 0; i < dropCount; i++) {
          let y = pos.array[i * 6 + 1] - velocities[i];
          if (y < -20) y = 20;
          pos.array[i * 6 + 1] = y;
          pos.array[i * 6 + 4] = y - 0.5;
        }
        pos.needsUpdate = true;

        // lightning timing
        flashTime += dt;
        if (flashTime > nextFlash) {
          flash.intensity = 8;
          setTimeout(() => { flash.intensity = 0; }, 80);
          flashTime = 0;
          nextFlash = 2 + Math.random() * 4;
        }
      };

      return group;
    },
  };

  /* ---------- Helpers ---------- */
  function makeCloud(color = 0xffffff, opacity = 0.85) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    const blobCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blobCount; i++) {
      const r = 0.8 + Math.random() * 0.6;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat);
      blob.position.set((i - blobCount / 2) * 1.2 + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0);
      group.add(blob);
    }
    return group;
  }

  return { init, setScene };
})();

/* ============================================================
   Weather SVG icons (compact, all inline)
   ============================================================ */
const ICONS = {
  sun: `<svg class="icon-sun" viewBox="0 0 64 64" fill="none">
    <circle cx="32" cy="32" r="12" fill="#fbbf24"/>
    <g stroke="#fbbf24" stroke-width="3" stroke-linecap="round">
      <line x1="32" y1="6" x2="32" y2="14"/>
      <line x1="32" y1="50" x2="32" y2="58"/>
      <line x1="6" y1="32" x2="14" y2="32"/>
      <line x1="50" y1="32" x2="58" y2="32"/>
      <line x1="13.5" y1="13.5" x2="19" y2="19"/>
      <line x1="45" y1="45" x2="50.5" y2="50.5"/>
      <line x1="13.5" y1="50.5" x2="19" y2="45"/>
      <line x1="45" y1="19" x2="50.5" y2="13.5"/>
    </g>
  </svg>`,
  'sun-cloud': `<svg class="icon-bob" viewBox="0 0 64 64" fill="none">
    <circle cx="22" cy="22" r="9" fill="#fbbf24"/>
    <g stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round">
      <line x1="22" y1="4" x2="22" y2="8"/>
      <line x1="4" y1="22" x2="8" y2="22"/>
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5"/>
      <line x1="34.5" y1="9.5" x2="31.5" y2="12.5"/>
    </g>
    <g fill="#cbd5e1">
      <ellipse cx="36" cy="38" rx="18" ry="9"/>
      <circle cx="26" cy="34" r="7"/>
      <circle cx="44" cy="34" r="8"/>
    </g>
  </svg>`,
  cloud: `<svg class="icon-bob" viewBox="0 0 64 64" fill="none">
    <g fill="#94a3b8">
      <ellipse cx="32" cy="38" rx="22" ry="11"/>
      <circle cx="20" cy="32" r="10"/>
      <circle cx="42" cy="30" r="12"/>
      <circle cx="32" cy="26" r="8"/>
    </g>
  </svg>`,
  fog: `<svg class="icon-bob" viewBox="0 0 64 64" fill="none">
    <g stroke="#cbd5e1" stroke-width="4" stroke-linecap="round">
      <line x1="10" y1="22" x2="54" y2="22"/>
      <line x1="6" y1="32" x2="50" y2="32"/>
      <line x1="14" y1="42" x2="58" y2="42"/>
      <line x1="10" y1="52" x2="46" y2="52"/>
    </g>
  </svg>`,
  rain: `<svg viewBox="0 0 64 64" fill="none">
    <g fill="#94a3b8">
      <ellipse cx="32" cy="26" rx="20" ry="10"/>
      <circle cx="20" cy="22" r="9"/>
      <circle cx="42" cy="20" r="11"/>
    </g>
    <g stroke="#60a5fa" stroke-width="3" stroke-linecap="round">
      <line x1="20" y1="40" x2="16" y2="52"/>
      <line x1="32" y1="40" x2="28" y2="52"/>
      <line x1="44" y1="40" x2="40" y2="52"/>
    </g>
  </svg>`,
  snow: `<svg viewBox="0 0 64 64" fill="none">
    <g fill="#cbd5e1">
      <ellipse cx="32" cy="22" rx="20" ry="10"/>
      <circle cx="20" cy="18" r="9"/>
      <circle cx="42" cy="16" r="11"/>
    </g>
    <g fill="#e0f2fe">
      <circle cx="18" cy="46" r="3"/>
      <circle cx="32" cy="50" r="3"/>
      <circle cx="46" cy="46" r="3"/>
    </g>
  </svg>`,
  bolt: `<svg viewBox="0 0 64 64" fill="none">
    <g fill="#475569">
      <ellipse cx="32" cy="22" rx="20" ry="10"/>
      <circle cx="20" cy="18" r="9"/>
      <circle cx="42" cy="16" r="11"/>
    </g>
    <path d="M 34 30 L 24 46 L 30 46 L 26 56 L 42 38 L 34 38 Z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`,
};

/* ============================================================
   Open-Meteo API
   ============================================================ */
async function geocode(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`City not found: "${city}"`);
  }
  const r = data.results[0];
  return {
    name: r.name,
    country: r.country || '',
    admin: r.admin1 || '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
  };
}

async function fetchForecast(lat, lon, tz) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(tz || 'auto')}&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Forecast fetch failed');
  return res.json();
}

/**
 * Reverse geocode coordinates to a friendly place name.
 * Uses BigDataCloud's browser-friendly client endpoint (no API key, CORS-enabled).
 * Falls back gracefully if the request fails.
 */
async function reverseGeocode(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    // Prefer the most specific populated place, then administrative subdivisions.
    const name = d.city || d.locality || d.principalSubdivision || d.countryName;
    if (!name) return null;
    return {
      name,
      country: d.countryName || '',
      admin: d.principalSubdivision || '',
      latitude: lat,
      longitude: lon,
      timezone: d.localityInfo?.informative?.find(i => /^[A-Z][a-z]+\/[A-Z][a-z]+$/.test(i.name || ''))?.name || 'auto',
    };
  } catch {
    return null;
  }
}

async function loadWeather(city) {
  showLoading(true);
  try {
    const loc = await geocode(city);
    const data = await fetchForecast(loc.latitude, loc.longitude, loc.timezone);
    const normalized = normalize(data);
    normalized.location = loc;
    state.data = normalized;
    state.location = loc;
    renderAll();
    Scene3D.setScene(normalized.current.sceneKey);
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

function normalize(data) {
  const cur = data.current;
  const code = cur.weather_code;
  const meta = WEATHER_CODES[code] || WEATHER_CODES[0];

  const hourly = [];
  const now = new Date(data.current.time);
  // find index of current hour
  let startIdx = data.hourly.time.findIndex(t => new Date(t) >= now);
  if (startIdx < 0) startIdx = 0;
  for (let i = 0; i < 24; i++) {
    const idx = startIdx + i;
    if (idx >= data.hourly.time.length) break;
    const t = new Date(data.hourly.time[idx]);
    const wc = data.hourly.weather_code[idx];
    hourly.push({
      time: t,
      label: t.toLocaleTimeString([], { hour: '2-digit' }),
      temp: data.hourly.temperature_2m[idx],
      iconKey: (WEATHER_CODES[wc] || WEATHER_CODES[0]).icon,
    });
  }

  const daily = [];
  for (let i = 0; i < data.daily.time.length; i++) {
    const t = new Date(data.daily.time[i]);
    const wc = data.daily.weather_code[i];
    const m = WEATHER_CODES[wc] || WEATHER_CODES[0];
    daily.push({
      date: t,
      dayName: t.toLocaleDateString([], { weekday: 'short' }),
      high: data.daily.temperature_2m_max[i],
      low: data.daily.temperature_2m_min[i],
      iconKey: m.icon,
    });
  }

  return {
    current: {
      temp: cur.temperature_2m,
      feels: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      weatherCode: code,
      conditionText: meta.text,
      iconKey: meta.icon,
      sceneKey: meta.scene,
      localTime: new Date(cur.time),
    },
    hourly,
    daily,
  };
}

/* ============================================================
   UI
   ============================================================ */
const state = {
  data: null,
  location: null,
  unit: 'c', // 'c' or 'f'
};

function renderAll() {
  if (!state.data) return;
  renderCurrent();
  renderHourly();
  renderDaily();
}

function renderCurrent() {
  const c = state.data.current;
  const loc = state.location;

  document.getElementById('city-name').textContent = loc ? formatLocation(loc) : '—';
  document.getElementById('condition-text').textContent = c.conditionText;
  document.getElementById('local-time').textContent = c.localTime.toLocaleString([], {
    weekday: 'long', hour: '2-digit', minute: '2-digit',
  });

  document.getElementById('temp-current').textContent = formatTemp(c.temp);
  document.getElementById('temp-unit').textContent = `°${state.unit.toUpperCase()}`;

  document.getElementById('humidity').textContent = `${c.humidity}%`;
  document.getElementById('wind').textContent = `${Math.round(c.wind)} km/h`;
  document.getElementById('feels').textContent = formatTemp(c.feels);

  document.getElementById('current-icon').innerHTML = ICONS[c.iconKey] || ICONS.sun;
}

function renderHourly() {
  const strip = document.getElementById('hourly-strip');
  strip.innerHTML = state.data.hourly.map(h => `
    <div class="hour">
      <span class="hour-time">${h.label}</span>
      <span class="hour-icon">${ICONS[h.iconKey] || ICONS.sun}</span>
      <span class="hour-temp">${formatTemp(h.temp)}°</span>
    </div>
  `).join('');
}

function renderDaily() {
  const grid = document.getElementById('daily-grid');
  grid.innerHTML = state.data.daily.map((d, i) => `
    <div class="day">
      <span class="day-name">${i === 0 ? 'Today' : d.dayName}</span>
      <span class="day-icon">${ICONS[d.iconKey] || ICONS.sun}</span>
      <span class="day-temps">
        <span class="day-high">${formatTemp(d.high)}°</span>
        <span class="day-low">${formatTemp(d.low)}°</span>
      </span>
    </div>
  `).join('');
}

function formatLocation(loc) {
  const parts = [loc.name];
  if (loc.admin && loc.admin !== loc.name) parts.push(loc.admin);
  if (loc.country) parts.push(loc.country);
  return parts.join(', ');
}

function formatTemp(c) {
  if (c === null || c === undefined) return '--';
  if (state.unit === 'f') return Math.round(c * 9 / 5 + 32);
  return Math.round(c);
}

/* ============================================================
   Wiring
   ============================================================ */
function setupListeners() {
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    if (q) loadWeather(q);
  });

  document.getElementById('geo-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return showToast('Geolocation not supported');
    showLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        // Run forecast + reverse geocode in parallel so the user waits once.
        const [data, place] = await Promise.all([
          fetchForecast(latitude, longitude, 'auto'),
          reverseGeocode(latitude, longitude),
        ]);
        const normalized = normalize(data);
        normalized.location = place || {
          name: 'Your location',
          country: '',
          admin: '',
          latitude,
          longitude,
          timezone: data.timezone,
        };
        state.data = normalized;
        state.location = normalized.location;
        renderAll();
        Scene3D.setScene(normalized.current.sceneKey);
      } catch (err) {
        showToast(err.message);
      } finally {
        showLoading(false);
      }
    }, (err) => {
      showLoading(false);
      showToast('Location permission denied');
    });
  });

  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.unit = btn.dataset.unit;
      renderAll();
    });
  });
}

function showLoading(on) {
  document.getElementById('loading').hidden = !on;
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

/* ============================================================
   Boot
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  // Try to start the 3D scene, but don't let a missing/broken WebGL block the rest of the UI.
  try {
    if (typeof THREE === 'undefined') {
      console.warn('Three.js failed to load — the 3D background is disabled, but the weather UI still works.');
    } else {
      Scene3D.init();
    }
  } catch (err) {
    console.error('3D scene failed to initialize:', err);
  }

  setupListeners();
  loadWeather(DEFAULT_CITY);
});
