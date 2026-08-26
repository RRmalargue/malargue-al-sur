/* ==========================================================
   LÓGICA PRINCIPAL - MALARGUE AL SUR DEPARTAMENTOS
   ========================================================== */

// Capturador de errores global para mostrar alertas en caso de fallos
window.onerror = function(message, source, lineno, colno, error) {
  alert("ERROR DETECTADO: " + message + "\nEn: " + source + " (Línea: " + lineno + ")\nDetalles: " + (error ? error.stack : ""));
  return false;
};

// --- CONFIGURACIÓN DE CONTACTO Y UBICACIÓN ---
// Número de WhatsApp del dueño (Configurable en producción)
const OWNER_PHONE = "5492604552146"; // Configurado al WhatsApp del propietario

// Coordenadas geográficas por defecto para el botón "Cómo llegar" (Malargüe, Mendoza)
// Puedes cambiar estos valores por las coordenadas exactas de tus departamentos
const MAP_LAT = -35.475556;
const MAP_LON = -69.577861;
const ALOJAMIENTO_NAME = "Malargüe al Sur Departamentos";

// Cifrado simple XOR + Hexadecimal para proteger datos en archivos públicos
const SECRET_KEY = "adminsur";

function encrypt(text, key = SECRET_KEY) {
  if (text === undefined || text === null) return "";
  const str = String(text);
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += ("0" + charCode.toString(16)).slice(-2);
  }
  return result;
}

function decrypt(hex, key = SECRET_KEY) {
  if (!hex) return "";
  try {
    let result = "";
    for (let i = 0; i < hex.length; i += 2) {
      const charCode = parseInt(hex.substr(i, 2), 16) ^ key.charCodeAt((i / 2) % key.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (e) {
    return "[Cifrado]";
  }
}

// Obtener las reservas desencriptadas (solo para el admin logueado)
function getDecryptedBookings() {
  const isLogged = localStorage.getItem("depto_admin_logged") === "true";
  const key = SECRET_KEY;
  return bookings.map(b => {
    if (b.isEncrypted) {
      return {
        ...b,
        name: isLogged ? decrypt(b.name, key) : "[Reservado]",
        phone: isLogged ? decrypt(b.phone, key) : "",
        notes: isLogged ? decrypt(b.notes, key) : "",
        totalPrice: isLogged ? (Number(decrypt(b.totalPrice, key)) || 0) : 0,
        deposit: isLogged ? (Number(decrypt(b.deposit, key)) || 0) : 0
      };
    }
    if (!isLogged) {
      return {
        ...b,
        name: "[Reservado]",
        phone: "",
        notes: "",
        totalPrice: 0,
        deposit: 0
      };
    }
    return {
      ...b,
      totalPrice: Number(b.totalPrice) || 0,
      deposit: Number(b.deposit) || 0
    };
  });
}

// Reservas externas importadas de canales iCal
let externalBookings = [];

// Combinar reservas locales desencriptadas y reservas de canales externos
function getAllActiveBookings() {
  const decrypted = getDecryptedBookings().filter(b => b.date !== "config" && b.date !== "analytics");
  return [...decrypted, ...externalBookings];
}

// Estado Global de la Aplicación
let bookings = [];
let expenses = []; // Gastos locales (limpieza, impuestos, reparaciones, etc.)
let currentDate = new Date();
let selectedDateStr = null;
let currentCarouselIndex = 0;

// Feriados nacionales en Argentina
let holidays = [];
let holidayNames = {};
let loadedHolidaysYear = null;
let adminSelectedDateStr = null; // Fecha seleccionada en el panel admin
let isEditMode = false;
let editOriginalDate = null;
let editOriginalSlot = null;

// Normalizar la URL de Supabase eliminando subrutas duplicadas
function normalizeSupabaseUrl(url) {
  if (!url) return "";
  let cleanUrl = url.trim();
  if (cleanUrl.endsWith("/")) {
    cleanUrl = cleanUrl.slice(0, -1);
  }
  if (cleanUrl.endsWith("/rest/v1")) {
    cleanUrl = cleanUrl.slice(0, -8);
  }
  if (cleanUrl.endsWith("/")) {
    cleanUrl = cleanUrl.slice(0, -1);
  }
  return cleanUrl;
}

// Configuración de Supabase por defecto
const DEFAULT_SB_URL = "https://qmavaeeivpbiefgpvxmw.supabase.co";
const DEFAULT_SB_KEY = "sb_publishable_oxLQ78P59OXqXBj1baKyYg_4Hh5RHps";

let supabaseUrl = normalizeSupabaseUrl(localStorage.getItem("depto_sb_url") || DEFAULT_SB_URL);
let supabaseKey = (localStorage.getItem("depto_sb_key") || DEFAULT_SB_KEY).trim();

// --- COMPORTAMIENTO DE DESLIZAMIENTO (SWIPE) ---
function setupSwipeGestures() {
  const mainCarousel = document.querySelector(".carousel-container");
  if (mainCarousel) {
    let startX = 0;
    mainCarousel.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    
    mainCarousel.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      const diffX = startX - endX;
      if (diffX > 50) moveCarousel(1);
      else if (diffX < -50) moveCarousel(-1);
    }, { passive: true });
  }

  const galleryCarousel = document.querySelector(".gallery-carousel-container");
  if (galleryCarousel) {
    let startX = 0;
    galleryCarousel.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    
    galleryCarousel.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      const diffX = startX - endX;
      if (diffX > 50) nextGallerySlide();
      else if (diffX < -50) prevGallerySlide();
    }, { passive: true });
  }

  const clientCalendar = document.querySelector(".calendar-wrapper");
  if (clientCalendar) {
    let startX = 0, startY = 0;
    clientCalendar.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    
    clientCalendar.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = startX - endX;
      const diffY = startY - endY;
      
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
        if (diffX > 0) {
          currentDate.setMonth(currentDate.getMonth() + 1);
        } else {
          currentDate.setMonth(currentDate.getMonth() - 1);
        }
        renderCalendar();
      }
    }, { passive: true });
  }

  const adminCalendar = document.querySelector(".admin-calendar-wrapper");
  if (adminCalendar) {
    let startX = 0, startY = 0;
    adminCalendar.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    
    adminCalendar.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = startX - endX;
      const diffY = startY - endY;
      
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
        if (diffX > 0) {
          currentDate.setMonth(currentDate.getMonth() + 1);
        } else {
          currentDate.setMonth(currentDate.getMonth() - 1);
        }
        renderAdminCalendar();
        renderAdminBookings();
      }
    }, { passive: true });
  }
}

// Inicialización al cargar el DOM
document.addEventListener("DOMContentLoaded", () => {
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.protocol === 'file:';
  
  if ('serviceWorker' in navigator && !isLocal) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('Service Worker registrado con éxito', reg);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('Nueva versión detectada. Recargando la aplicación...');
              window.location.reload();
            }
          });
        });
      })
      .catch(err => console.warn('Error al registrar sw', err));
  } else if ('serviceWorker' in navigator && isLocal) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let registration of registrations) {
        registration.unregister();
      }
    });
  }

  initApp();
  setupSwipeGestures();

  // PWA Prompt
  let deferredPrompt;
  const installBtn = document.getElementById("install-pwa-btn");
  const pwaBanner = document.getElementById("pwa-install-banner");
  const iosBanner = document.getElementById("pwa-ios-banner");

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone && sessionStorage.getItem("pwa_dismissed") !== "true") {
    if (iosBanner) iosBanner.classList.remove("hidden");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (sessionStorage.getItem("pwa_dismissed") !== "true" && pwaBanner) {
      pwaBanner.classList.remove("hidden");
    }
    if (installBtn) installBtn.classList.remove("hidden");
  });

  const acceptBtn = document.getElementById("pwa-install-accept");
  const declineBtn = document.getElementById("pwa-install-decline");

  if (acceptBtn) {
    acceptBtn.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Instalación: ${outcome}`);
        deferredPrompt = null;
        if (pwaBanner) pwaBanner.classList.add("hidden");
        if (installBtn) installBtn.classList.add("hidden");
      }
    });
  }

  if (declineBtn) {
    declineBtn.addEventListener("click", () => {
      if (pwaBanner) pwaBanner.classList.add("hidden");
      sessionStorage.setItem("pwa_dismissed", "true");
    });
  }

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
        installBtn.classList.add("hidden");
        if (pwaBanner) pwaBanner.classList.add("hidden");
      }
    });
  }

  const iosCloseBtn = document.getElementById("pwa-ios-close");
  if (iosCloseBtn && iosBanner) {
    iosCloseBtn.addEventListener("click", () => {
      iosBanner.classList.add("hidden");
      sessionStorage.setItem("pwa_dismissed", "true");
    });
  }

  window.addEventListener("appinstalled", async () => {
    if (installBtn) installBtn.classList.add("hidden");
    if (pwaBanner) pwaBanner.classList.add("hidden");

    const installRecord = {
      date: "analytics",
      slot: "install",
      name: encrypt("Device Installed", SECRET_KEY),
      phone: encrypt(isIOS ? "iOS/Safari" : "Android/Chrome", SECRET_KEY),
      isEncrypted: true,
      isGCal: false,
      totalPrice: encrypt("0", SECRET_KEY),
      deposit: encrypt("0", SECRET_KEY),
      notes: encrypt(new Date().toISOString(), SECRET_KEY)
    };
    await saveBooking(installRecord);
    localStorage.setItem("depto_pwa_tracked", "true");
  });

  if (isStandalone && localStorage.getItem("depto_pwa_tracked") !== "true") {
    const installRecord = {
      date: "analytics",
      slot: "install",
      name: encrypt("Standalone Launch", SECRET_KEY),
      phone: encrypt(isIOS ? "iOS/Safari" : "Android/Chrome", SECRET_KEY),
      isEncrypted: true,
      isGCal: false,
      totalPrice: encrypt("0", SECRET_KEY),
      deposit: encrypt("0", SECRET_KEY),
      notes: encrypt(new Date().toISOString(), SECRET_KEY)
    };
    saveBooking(installRecord).then(() => {
      localStorage.setItem("depto_pwa_tracked", "true");
    });
  }

  // Auto-login si ya estaba logueado
  if (localStorage.getItem("depto_admin_logged") === "true") {
    const adminNav = document.getElementById("nav-nav-admin-section");
    if (adminNav) adminNav.classList.remove("hidden");
  }

  // Acceso secreto a Administración (5 clics en el logo)
  let logoClicksCount = 0;
  const headerLogo = document.getElementById("headerLogo");
  if (headerLogo) {
    headerLogo.addEventListener("click", () => {
      logoClicksCount++;
      if (logoClicksCount >= 5) {
        logoClicksCount = 0;
        const password = prompt("Ingrese la contraseña de Administrador:");
        if (password === "adminsur" || password === "admin123") {
          const adminNav = document.getElementById("nav-nav-admin-section");
          if (adminNav) adminNav.classList.remove("hidden");
          localStorage.setItem("depto_admin_logged", "true");
          sessionStorage.setItem("admin_key", password);
          switchTab("admin-section");
          showAdminPanel();
          alert("Acceso Administrador habilitado.");
        } else if (password !== null) {
          alert("Contraseña incorrecta.");
        }
      }
    });
  }

  // Controles Calendario Clientes
  document.getElementById("prev-month-btn").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
    renderAdminCalendar();
    renderAdminBookings();
  });
  document.getElementById("next-month-btn").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
    renderAdminCalendar();
    renderAdminBookings();
  });

  // Controles Calendario Admin
  const adminPrevBtn = document.getElementById("admin-prev-month-btn");
  const adminNextBtn = document.getElementById("admin-next-month-btn");
  if (adminPrevBtn) {
    adminPrevBtn.addEventListener("click", () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      renderCalendar();
      renderAdminCalendar();
      renderAdminBookings();
    });
  }
  if (adminNextBtn) {
    adminNextBtn.addEventListener("click", () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      renderCalendar();
      renderAdminCalendar();
      renderAdminBookings();
    });
  }

  if (localStorage.getItem("depto_admin_logged") === "true") {
    showAdminPanel();
  }

  // Auto-slide carrusel cada 5 segundos
  setInterval(() => {
    moveCarousel(1);
  }, 5000);
});

// --- CARGA DE DATOS ---
async function initApp() {
  await initCarouselGallery();
  await loadBookings();
  loadWifiConfig();
  loadIcalConfig();
  loadExpenses();
  await syncExternalCalendars();
  renderCalendar();
  renderAdminCalendar();
  
  // Establecer fecha por defecto en hoy
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  
  if (document.getElementById("admin-date")) document.getElementById("admin-date").value = todayStr;
  if (document.getElementById("expense-date")) document.getElementById("expense-date").value = todayStr;
  
  // Limpieza inicial
  const cleaningCost = localStorage.getItem("depto_cleaning_cost") || "6000";
  const cleaningInput = document.getElementById("cleaning-cost-input");
  if (cleaningInput) cleaningInput.value = cleaningCost;

  // Actualizar seña si Pago Completo está tildado
  const totalPriceInput = document.getElementById("admin-total-price");
  if (totalPriceInput) {
    totalPriceInput.addEventListener("input", () => {
      const paidFullCheckbox = document.getElementById("admin-paid-full");
      if (paidFullCheckbox && paidFullCheckbox.checked) {
        document.getElementById("admin-deposit").value = totalPriceInput.value || 0;
      }
    });
  }

  // Mes por defecto en finanzas
  const monthSelect = document.getElementById("finance-month");
  if (monthSelect) {
    monthSelect.value = new Date().getMonth().toString();
  }

  renderExpenses();
  populateFinanceYears();
  updateFinanceSummary();
  
  if (supabaseUrl) document.getElementById("sb-url").value = supabaseUrl;
  if (supabaseKey) document.getElementById("sb-key").value = supabaseKey;

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// Cargar desde Supabase, local o mock
async function loadBookings() {
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/bookings?select=*`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
      if (response.ok) {
        bookings = await response.json();
        console.log("Reservas cargadas de Supabase", bookings);
        localStorage.setItem("depto_bookings_backup", JSON.stringify(bookings));
        updateInstallationsCountDisplay();
        return;
      }
    } catch (e) {
      console.warn("Fallo Supabase, usando respaldo local...", e);
    }
  }

  const localData = localStorage.getItem("depto_bookings_backup");
  if (localData) {
    bookings = JSON.parse(localData);
    updateInstallationsCountDisplay();
    return;
  }

  // Datos mock por defecto (Agosto 2026)
  const defaultMockBookings = [
    { "date": "2026-08-15", "slot": "full", "name": "Pedro Gomez", "phone": "5492604123456", "totalPrice": 45000, "deposit": 15000, "isEncrypted": false },
    { "date": "2026-08-16", "slot": "full", "name": "Juan Perez", "phone": "5492604765432", "totalPrice": 40000, "deposit": 40000, "isEncrypted": false },
    { "date": "2026-08-22", "slot": "full", "name": "Maria Lopez", "totalPrice": 45000, "deposit": 0, "isEncrypted": false },
    { "date": "2026-08-23", "slot": "full", "name": "Carlos Diaz", "phone": "5492604555555", "totalPrice": 45000, "deposit": 15000, "isEncrypted": false }
  ];

  bookings = defaultMockBookings;
  localStorage.setItem("depto_bookings_backup", JSON.stringify(bookings));
  updateInstallationsCountDisplay();
}

async function saveBooking(booking) {
  const encryptedBooking = booking.isEncrypted ? booking : {
    date: booking.date,
    slot: booking.slot,
    name: encrypt(booking.name),
    phone: encrypt(booking.phone),
    totalPrice: encrypt(booking.totalPrice),
    deposit: encrypt(booking.deposit),
    notes: encrypt(booking.notes || ""),
    isEncrypted: true,
    isGCal: booking.isGCal || false
  };

  bookings.push(encryptedBooking);
  localStorage.setItem("depto_bookings_backup", JSON.stringify(bookings));

  if (supabaseUrl && supabaseKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/bookings`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(encryptedBooking)
      });
    } catch (e) {
      console.error("Error Supabase", e);
    }
  }
}

async function deleteBooking(date, slot) {
  bookings = bookings.filter(b => !(b.date === date && b.slot === slot));
  localStorage.setItem("depto_bookings_backup", JSON.stringify(bookings));

  if (supabaseUrl && supabaseKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/bookings?date=eq.${date}&slot=eq.${slot}`, {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
    } catch (e) {
      console.error("Error al borrar en Supabase", e);
    }
  }
}

// --- NAVEGACIÓN SPA ---
function switchTab(sectionId) {
  document.querySelectorAll(".tab-content").forEach(tab => {
    tab.classList.remove("active");
  });
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.remove("active");
  });

  document.getElementById(sectionId).classList.add("active");
  // Buscar nav link tanto con nav- como sin
  const navBtn = document.getElementById(`nav-${sectionId}`) || document.getElementById(`nav-nav-${sectionId}`);
  if (navBtn) navBtn.classList.add("active");

  if (sectionId === "calendar-section") {
    renderCalendar();
    document.getElementById("day-details-box").classList.add("hidden");
  } else if (sectionId === "admin-section") {
    if (localStorage.getItem("depto_admin_logged") === "true") {
      showAdminPanel();
    }
  }
}

// --- CARRUSEL FOTOS ---
function moveCarousel(step) {
  const slides = document.querySelectorAll(".carousel-slide");
  const indicators = document.querySelectorAll(".carousel-indicators .indicator");
  if (slides.length === 0) return;
  
  slides[currentCarouselIndex].classList.remove("active");
  indicators[currentCarouselIndex].classList.remove("active");

  currentCarouselIndex = (currentCarouselIndex + step + slides.length) % slides.length;

  slides[currentCarouselIndex].classList.add("active");
  indicators[currentCarouselIndex].classList.add("active");
}

function setCarouselSlide(index) {
  const slides = document.querySelectorAll(".carousel-slide");
  const indicators = document.querySelectorAll(".carousel-indicators .indicator");
  if (slides.length === 0) return;

  slides[currentCarouselIndex].classList.remove("active");
  indicators[currentCarouselIndex].classList.remove("active");

  currentCarouselIndex = index;

  slides[currentCarouselIndex].classList.add("active");
  indicators[currentCarouselIndex].classList.add("active");
}

// --- CALENDARIO CLIENTES ---
async function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  document.getElementById("calendar-month-year").innerText = `${monthNames[month]} ${year}`;

  if (loadedHolidaysYear !== year) {
    loadedHolidaysYear = year;
    await fetchHolidays(year);
  }

  const grid = document.getElementById("calendar-days-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "calendar-day empty";
    grid.appendChild(emptyDay);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayEl = document.createElement("div");
    dayEl.className = "calendar-day day-free";

    const dayOfWeek = new Date(year, month, day).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) dayEl.classList.add("weekend");

    const isHoliday = holidays.includes(dateStr);
    if (isHoliday) {
      dayEl.classList.add("holiday");
      dayEl.setAttribute("title", holidayNames[dateStr] || "Feriado");
    }

    const isSpecialDay = isWeekend || isHoliday;
    const dayBookings = getAllActiveBookings().filter(b => b.date === dateStr);
    const isReserved = dayBookings.length > 0;

    dayEl.style.background = "transparent";

    if (isReserved) {
      dayEl.className = "calendar-day day-rented";
    } else {
      dayEl.className = "calendar-day day-free";
      if (isWeekend) dayEl.classList.add("weekend");
      if (isHoliday) dayEl.classList.add("holiday");
    }

    const dayColor = isReserved ? "#fca5a5" : (isSpecialDay ? "#fde68a" : "#a7f3d0");
    const slotClass = isReserved ? "slot-full slot-rented" : "slot-full";

    dayEl.innerHTML = `
      <div class="${slotClass}" style="background-color: ${dayColor};"></div>
      <span class="day-number">${day}</span>
    `;

    if (selectedDateStr === dateStr) {
      dayEl.classList.add("selected");
    }

    dayEl.addEventListener("click", () => {
      document.querySelectorAll("#calendar-days-grid .calendar-day").forEach(el => el.classList.remove("selected"));
      dayEl.classList.add("selected");
      selectedDateStr = dateStr;
      showDayDetails(dateStr);
      
      const adminDateEl = document.getElementById("admin-date");
      if (adminDateEl) adminDateEl.value = dateStr;
    });

    grid.appendChild(dayEl);
  }
}

function showDayDetails(dateStr) {
  const [year, month, day] = dateStr.split("-");
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  
  const dateObj = new Date(year, parseInt(month) - 1, day);
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const dayName = weekdays[dateObj.getDay()];
  
  document.getElementById("selected-day-title").innerText = `${dayName}, ${day} de ${months[parseInt(month) - 1]}`;

  const dayBookings = getAllActiveBookings().filter(b => b.date === dateStr);
  const isReserved = dayBookings.length > 0;

  const statusEl = document.getElementById("slot-day-status");
  const btnEl = document.getElementById("slot-day-btn");

  if (isReserved) {
    statusEl.innerText = "No Disponible";
    statusEl.className = "badge badge-danger";
    btnEl.innerText = "Reservado";
    btnEl.disabled = true;
    btnEl.className = "btn btn-sm btn-outline-danger";
  } else {
    statusEl.innerText = "Disponible";
    statusEl.className = "badge badge-success";
    btnEl.innerText = "Solicitar Reserva";
    btnEl.disabled = false;
    btnEl.className = "btn btn-sm btn-outline-primary";
  }

  document.getElementById("day-details-box").classList.remove("hidden");

  const msg = isReserved ? "Lo lamento, este día ya está ocupado 🔴" : "¡El departamento está libre este día! 🟢";
  showToast(msg, isReserved ? "danger" : "success");
}

function showToast(msg, type) {
  const toast = document.getElementById("calendar-toast-box");
  if (!toast) return;
  toast.innerText = msg;
  toast.className = `calendar-toast-box calendar-toast-${type}`;
  toast.classList.remove("hidden");
}

// --- RESERVAS WHATSAPP ---
function openBookingForm(slot) {
  if (!selectedDateStr) return;
  document.getElementById("form-date").value = selectedDateStr;
  document.getElementById("form-display-date").value = selectedDateStr.split("-").reverse().join("/");
  document.getElementById("booking-modal").classList.remove("hidden");
}

function closeBookingModal() {
  document.getElementById("booking-modal").classList.add("hidden");
  document.getElementById("booking-form").reset();
}

function handleBookingSubmit(event) {
  event.preventDefault();
  const date = document.getElementById("form-date").value;
  const name = document.getElementById("client-name").value;
  const phone = document.getElementById("client-phone").value;
  const guests = document.getElementById("client-guests").value || "1";
  const notes = document.getElementById("client-notes").value || "Ninguna";

  const formattedDate = date.split("-").reverse().join("/");

  const text = `¡Hola! Vengo de la aplicación de reservas de *MALARGUE AL SUR DEPARTAMENTOS* 🏡\n\n` + 
               `Quiero consultar por el alquiler del depto:\n` +
               `📅 *Fecha de Ingreso:* ${formattedDate}\n` +
               `👥 *Huéspedes:* ${guests} personas\n` +
               `👤 *Nombre:* ${name}\n` +
               `📞 *WhatsApp de contacto:* ${phone}\n` +
               `💬 *Mensaje/Consulta:* ${notes}\n\n` +
               `*Espero su respuesta para coordinar la seña y tarifa final.*`;

  const url = `https://wa.me/${OWNER_PHONE}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
  closeBookingModal();
}

// --- PANEL DE ADMINISTRACIÓN ---
function handleAdminLogin(event) {
  event.preventDefault();
  const password = document.getElementById("admin-password").value;

  if (password === "adminsur" || password === "admin123") {
    localStorage.setItem("depto_admin_logged", "true");
    sessionStorage.setItem("admin_key", password);
    showAdminPanel();
    document.getElementById("admin-password").value = "";
    document.getElementById("login-error").classList.add("hidden");
  } else {
    document.getElementById("login-error").classList.remove("hidden");
  }
}

function showAdminPanel() {
  document.getElementById("admin-login-box").classList.add("hidden");
  document.getElementById("admin-panel").classList.remove("hidden");
  
  updateInstallationsCountDisplay();
  checkUpcomingBookingsAlerts();
  renderAdminBookings();
  renderAdminCalendar();
  renderExpenses();
  populateFinanceYears();
  updateFinanceSummary();
}

function handleAdminLogout() {
  localStorage.setItem("depto_admin_logged", "false");
  document.getElementById("admin-panel").classList.add("hidden");
  document.getElementById("admin-login-box").classList.remove("hidden");
}

function checkUpcomingBookingsAlerts() {
  const alertContainer = document.getElementById("admin-upcoming-alerts");
  if (!alertContainer) return;
  alertContainer.innerHTML = "";
  alertContainer.classList.add("hidden");

  const decryptedBookingsList = getDecryptedBookings();
  const now = new Date();
  
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const upcoming = decryptedBookingsList.filter(b => {
    if (!b || !b.date || typeof b.date !== 'string') return false;
    if (b.date === "config" || b.date === "analytics") return false;
    return b.date === todayStr || b.date === tomorrowStr;
  });

  if (upcoming.length === 0) return;

  upcoming.forEach(b => {
    const formattedDate = b.date.split("-").reverse().join("/");
    let cleanPhone = b.phone ? b.phone.replace(/\D/g, '') : "";
    if (cleanPhone.length === 10) cleanPhone = "549" + cleanPhone;
    else if (cleanPhone.length === 11 && cleanPhone.startsWith("0")) cleanPhone = "549" + cleanPhone.substring(1);
    else if (cleanPhone.length === 11 && cleanPhone.startsWith("9")) cleanPhone = "54" + cleanPhone;
    else if (cleanPhone.length === 12 && cleanPhone.startsWith("54")) cleanPhone = "549" + cleanPhone.substring(2);

    const reminderText = `¡Hola ${b.name}! Le recordamos su reserva en Malargüe al Sur Departamentos para hoy/mañana (${formattedDate}). Check-in habilitado desde las 14:00 hs. ¡Buen viaje! 🏡`;
    const waReminderLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(reminderText)}` : "#";

    const alertCard = document.createElement("div");
    alertCard.className = "card";
    alertCard.style = "background: rgba(239, 68, 68, 0.08); border: 1px solid var(--danger); display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px;";
    alertCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
        <div style="flex: 1; min-width: 200px;">
          <h4 style="color: var(--danger); font-size: 14px; margin-bottom: 4px; display: inline-flex; align-items: center; gap: 6px;"><i class="fa-solid fa-bell-exclamation fa-shake"></i> Recordatorio Check-in</h4>
          <p style="font-size: 13px; margin: 0; color: var(--text-primary);">Cliente: <strong>${b.name}</strong> | Fecha: <strong>${formattedDate}</strong></p>
        </div>
        ${cleanPhone ? `
          <a href="${waReminderLink}" target="_blank" class="btn btn-sm btn-success" style="margin: 0; padding: 6px 12px; font-size: 11px; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; text-decoration: none; border-radius: 6px;">
            <i class="fa-brands fa-whatsapp"></i> Recordar Ingreso
          </a>
        ` : `<span class="badge badge-secondary" style="font-size:10px;">Sin Teléfono</span>`}
      </div>
    `;
    alertContainer.appendChild(alertCard);
  });

  alertContainer.classList.remove("hidden");
}

function updateInstallationsCountDisplay() {
  const count = bookings.filter(b => b.date === "analytics" && b.slot === "install").length;
  const numEl = document.getElementById("admin-install-number");
  if (numEl) numEl.innerText = count;
}

function clearAdminDayFilter(event) {
  if (event) event.preventDefault();
  adminSelectedDateStr = null;
  document.querySelectorAll("#admin-calendar-days-grid .calendar-day").forEach(el => el.classList.remove("selected"));
  document.getElementById("admin-booking-fields-collapsible").classList.add("hidden");
  renderAdminBookings();
}

function renderAdminBookings() {
  const tbody = document.getElementById("admin-bookings-list");
  if (!tbody) return;
  tbody.innerHTML = "";

  const viewYear = currentDate.getFullYear();
  const viewMonth = currentDate.getMonth() + 1;

  const decryptedBookingsList = getAllActiveBookings();
  const filteredBookings = decryptedBookingsList.filter(b => {
    const [y, m, d] = b.date.split("-").map(Number);
    if (y !== viewYear || m !== viewMonth) return false;
    if (adminSelectedDateStr) return b.date === adminSelectedDateStr;
    return true;
  });

  const sortedBookings = [...filteredBookings].sort((a, b) => a.date.localeCompare(b.date));

  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const listTitle = document.getElementById("admin-bookings-title");
  if (listTitle) {
    if (adminSelectedDateStr) {
      const [y, m, d] = adminSelectedDateStr.split("-").map(Number);
      listTitle.innerHTML = `<i class="fa-solid fa-list-check"></i> Reservas del ${d}/${m}/${y} <a href="#" onclick="clearAdminDayFilter(event)" style="font-size: 11px; margin-left: 10px; color: var(--accent); text-decoration: underline;">[Ver mes completo]</a>`;
    } else {
      listTitle.innerHTML = `<i class="fa-solid fa-list-check"></i> Reservas de ${monthNames[currentDate.getMonth()]} ${viewYear}`;
    }
  }

  if (sortedBookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-secondary">No hay reservas para este mes.</td></tr>`;
    return;
  }

  sortedBookings.forEach(b => {
    const tr = document.createElement("tr");
    const formattedDate = b.date.split("-").reverse().join("/");
    const slotLabel = "Día Completo";

    const totalPrice = b.isExternal ? "-" : (b.totalPrice !== undefined ? `$${b.totalPrice}` : "-");
    const deposit = b.isExternal ? "-" : (b.deposit !== undefined ? `$${b.deposit}` : "-");
    const balance = b.isExternal ? "-" : ((b.totalPrice !== undefined && b.deposit !== undefined) ? `$${b.totalPrice - b.deposit}` : "-");

    let waLink = "";
    if (b.phone && b.phone !== "GCal" && b.phone !== "Booking" && b.phone !== "Airbnb") {
      let cleanPhone = b.phone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = "549" + cleanPhone;
      else if (cleanPhone.length === 11 && cleanPhone.startsWith("0")) cleanPhone = "549" + cleanPhone.substring(1);
      else if (cleanPhone.length === 11 && cleanPhone.startsWith("9")) cleanPhone = "54" + cleanPhone;
      else if (cleanPhone.length === 12 && cleanPhone.startsWith("54")) cleanPhone = "549" + cleanPhone.substring(2);
      
      waLink = `<a href="https://wa.me/${cleanPhone}" target="_blank" class="badge" style="background-color: #25d366; color: white; margin-left: 8px; font-size: 11px; padding: 3px 7px; text-decoration: none; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500;"><i class="fa-brands fa-whatsapp"></i> Chat</a>`;
    }
    
    const notesDiv = b.notes ? `<div class="text-muted text-xs" style="margin-top: 4px; font-style: italic;"><i class="fa-regular fa-comment-dots"></i> ${b.notes}</div>` : "";
    const clientName = `${b.name}${waLink}${notesDiv}`;

    // Google Calendar Link
    const dateClean = b.date.replace(/-/g, '');
    const startGCal = `${dateClean}T140000`;
    
    // Check out al día siguiente a las 10:00 hs
    const checkOutDate = new Date(b.date + "T12:00:00");
    checkOutDate.setDate(checkOutDate.getDate() + 1);
    const endGCalClean = `${checkOutDate.getFullYear()}${String(checkOutDate.getMonth() + 1).padStart(2, '0')}${String(checkOutDate.getDate()).padStart(2, '0')}T100000`;
    
    const gcalTitle = encodeURIComponent(`Depto: ${b.name}`);
    const gcalDetails = encodeURIComponent(`Monto Total: $${b.totalPrice}\nSeña: $${b.deposit}\nWhatsApp: ${b.phone || ''}\nNotas: ${b.notes || ''}`);
    const gcalLink = `https://www.google.com/calendar/render?action=TEMPLATE&text=${gcalTitle}&dates=${startGCal}/${endGCalClean}&details=${gcalDetails}`;

    let actionsHtml = "";
    if (b.isExternal) {
      actionsHtml = `<span class="badge badge-warning" style="font-size:9px; display:inline-flex; align-items:center; gap:3px; padding: 4px 6px;"><i class="fa-solid fa-rotate"></i> Canal</span>`;
    } else {
      actionsHtml = `
        <div class="btn-group-row" style="display:flex; gap:4px;">
          <a href="${gcalLink}" target="_blank" class="btn btn-sm btn-outline-success" title="Agregar Alarma Celular" style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; text-decoration: none;">
            <i class="fa-solid fa-calendar-plus"></i>
          </a>
          <button class="btn btn-sm btn-outline-primary" onclick="editBookingAdmin('${b.date}', '${b.slot}')" style="width: 30px; height: 30px; padding: 0;">
            <i class="fa-regular fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteBookingAdmin('${b.date}', '${b.slot}')" style="width: 30px; height: 30px; padding: 0;">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      `;
    }

    tr.innerHTML = `
      <td><strong>${formattedDate}</strong></td>
      <td>${slotLabel}</td>
      <td>${clientName}</td>
      <td>${totalPrice}</td>
      <td>${deposit}</td>
      <td><span style="font-weight: 600; color: ${b.isExternal ? 'var(--text-secondary)' : (b.totalPrice - b.deposit > 0 ? 'var(--warning)' : 'var(--success)')}">${balance}</span></td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Eliminar
async function deleteBookingAdmin(date, slot) {
  if (confirm(`¿Seguro que deseas eliminar la reserva del ${date.split("-").reverse().join("/")}?`)) {
    await deleteBooking(date, slot);
    renderAdminBookings();
    renderAdminCalendar();
    renderCalendar();
    
    updateFinanceSummary();
    populateFinanceYears();
    
    if (selectedDateStr === date) {
      showDayDetails(date);
    }

    alert("Reserva cancelada en el sistema. Se abrirá Google Calendar en esa fecha para que verifiques si deseas eliminar el evento.");
    openGoogleCalendarOnDate(date);
  }
}

// Crear/Editar manual
async function handleAdminManualBooking(event) {
  event.preventDefault();
  const date = document.getElementById("admin-date").value;
  const slot = document.getElementById("admin-slot").value;
  const name = document.getElementById("admin-name").value;
  const phone = document.getElementById("admin-phone").value.trim();
  const totalPriceVal = parseInt(document.getElementById("admin-total-price").value) || 0;
  const depositVal = parseInt(document.getElementById("admin-deposit").value) || 0;
  const notesVal = document.getElementById("admin-notes").value.trim();

  const exists = bookings.some(b => 
    b.date === date && 
    b.slot === slot && 
    !(isEditMode && editOriginalDate === date && editOriginalSlot === slot)
  );
  if (exists) {
    alert("Esta fecha ya se encuentra reservada.");
    return;
  }

  const newBooking = { 
    date, 
    slot, 
    name, 
    phone, 
    totalPrice: totalPriceVal, 
    deposit: depositVal,
    notes: notesVal
  };

  if (isEditMode) {
    await deleteBooking(editOriginalDate, editOriginalSlot);
    await saveBooking(newBooking);
    cancelAdminEdit();
  } else {
    await saveBooking(newBooking);
  }

  showPostBookingModal(newBooking);

  // Limpiar
  document.getElementById("admin-name").value = "";
  document.getElementById("admin-phone").value = "";
  document.getElementById("admin-total-price").value = "";
  document.getElementById("admin-deposit").value = "0";
  document.getElementById("admin-deposit").disabled = false;
  document.getElementById("admin-notes").value = "";
  
  const paidFullCheckbox = document.getElementById("admin-paid-full");
  if (paidFullCheckbox) paidFullCheckbox.checked = false;
  
  document.getElementById("admin-booking-fields-collapsible").classList.add("hidden");
  adminSelectedDateStr = null;

  renderAdminBookings();
  renderAdminCalendar();
  renderCalendar();
  
  updateFinanceSummary();
  populateFinanceYears();
}

// Edición
function editBookingAdmin(date, slot) {
  const b = bookings.find(x => x.date === date && x.slot === slot);
  if (!b) return;
  
  const key = SECRET_KEY;
  const name = b.isEncrypted ? decrypt(b.name, key) : b.name;
  const phone = b.isEncrypted ? decrypt(b.phone, key) : b.phone;
  const totalPrice = b.isEncrypted ? decrypt(b.totalPrice, key) : b.totalPrice;
  const deposit = b.isEncrypted ? decrypt(b.deposit, key) : b.deposit;
  const notes = b.isEncrypted ? decrypt(b.notes, key) : b.notes;

  isEditMode = true;
  editOriginalDate = date;
  editOriginalSlot = slot;

  document.getElementById("admin-date").value = date;
  document.getElementById("admin-slot").value = slot;
  document.getElementById("admin-name").value = name;
  document.getElementById("admin-phone").value = phone;
  document.getElementById("admin-total-price").value = totalPrice;
  document.getElementById("admin-deposit").value = deposit;
  document.getElementById("admin-notes").value = notes;

  document.getElementById("admin-paid-full").checked = (Number(totalPrice) === Number(deposit));
  document.getElementById("admin-deposit").disabled = (Number(totalPrice) === Number(deposit));

  document.getElementById("admin-booking-fields-title").innerHTML = `<i class="fa-solid fa-edit"></i> Editar Reserva: ${date.split("-").reverse().join("/")}`;
  document.getElementById("admin-submit-btn").innerText = "Guardar Cambios";
  
  document.getElementById("admin-delete-edit-btn").classList.remove("hidden");
  document.getElementById("admin-cancel-edit-btn").classList.remove("hidden");

  const fieldsBox = document.getElementById("admin-booking-fields-collapsible");
  fieldsBox.classList.remove("hidden");
  fieldsBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelAdminEdit() {
  isEditMode = false;
  editOriginalDate = null;
  editOriginalSlot = null;

  document.getElementById("admin-booking-fields-title").innerHTML = `<i class="fa-solid fa-edit"></i> Registrar Nueva Reserva`;
  document.getElementById("admin-submit-btn").innerText = "Confirmar Reserva";
  
  document.getElementById("admin-delete-edit-btn").classList.add("hidden");
  document.getElementById("admin-cancel-edit-btn").classList.add("hidden");
  
  document.getElementById("admin-name").value = "";
  document.getElementById("admin-phone").value = "";
  document.getElementById("admin-total-price").value = "";
  document.getElementById("admin-deposit").value = "0";
  document.getElementById("admin-deposit").disabled = false;
  document.getElementById("admin-notes").value = "";
  
  const paidFullCheckbox = document.getElementById("admin-paid-full");
  if (paidFullCheckbox) paidFullCheckbox.checked = false;
}

async function deleteCurrentEditBooking() {
  if (editOriginalDate && editOriginalSlot) {
    if (confirm(`¿Seguro que deseas eliminar la reserva del ${editOriginalDate.split("-").reverse().join("/")}?`)) {
      await deleteBooking(editOriginalDate, editOriginalSlot);
      cancelAdminEdit();
      renderAdminBookings();
      renderAdminCalendar();
      renderCalendar();
      updateFinanceSummary();
      populateFinanceYears();
      
      if (selectedDateStr === editOriginalDate) {
        showDayDetails(editOriginalDate);
      }
    }
  }
}

// --- CALENDARIO INTERACTIVO ADMIN ---
async function renderAdminCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const headerEl = document.getElementById("admin-calendar-month-year");
  if (headerEl) headerEl.innerText = `${monthNames[month]} ${year}`;

  const grid = document.getElementById("admin-calendar-days-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "calendar-day empty";
    grid.appendChild(emptyDay);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayEl = document.createElement("div");
    dayEl.className = "calendar-day";

    const dayOfWeek = new Date(year, month, day).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) dayEl.classList.add("weekend");

    const isHoliday = holidays.includes(dateStr);
    if (isHoliday) {
      dayEl.classList.add("holiday");
      dayEl.setAttribute("title", holidayNames[dateStr] || "Feriado");
    }

    const isSpecialDay = isWeekend || isHoliday;
    const dayBookings = getAllActiveBookings().filter(b => b.date === dateStr);
    const isReserved = dayBookings.length > 0;

    dayEl.style.background = "transparent";

    if (isReserved) {
      dayEl.className = "calendar-day day-rented";
    } else {
      dayEl.className = "calendar-day day-free";
      if (isWeekend) dayEl.classList.add("weekend");
      if (isHoliday) dayEl.classList.add("holiday");
    }

    const dayColor = isReserved ? "#fca5a5" : (isSpecialDay ? "#fde68a" : "#a7f3d0");
    const slotClass = isReserved ? "slot-full slot-rented" : "slot-full";

    dayEl.innerHTML = `
      <div class="${slotClass}" style="background-color: ${dayColor};"></div>
      <span class="day-number">${day}</span>
    `;

    if (adminSelectedDateStr === dateStr) {
      dayEl.classList.add("selected");
    }

    dayEl.addEventListener("click", () => {
      document.querySelectorAll("#admin-calendar-days-grid .calendar-day").forEach(el => el.classList.remove("selected"));
      dayEl.classList.add("selected");
      adminSelectedDateStr = dateStr;
      
      openAdminBookingForm(dateStr);
      renderAdminBookings();
    });

    grid.appendChild(dayEl);
  }
}

function openAdminBookingForm(dateStr) {
  const [year, month, day] = dateStr.split("-");
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  
  document.getElementById("admin-date").value = dateStr;
  document.getElementById("admin-booking-fields-title").innerText = `Registrar reserva para el día ${day} de ${months[parseInt(month) - 1]} de ${year}`;
  
  const collapsible = document.getElementById("admin-booking-fields-collapsible");
  collapsible.classList.remove("hidden");
  collapsible.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- COSTOS, FINANZAS Y GASTOS ---
function saveCleaningCost() {
  const input = document.getElementById("cleaning-cost-input");
  if (input) {
    const cost = parseInt(input.value) || 0;
    localStorage.setItem("depto_cleaning_cost", cost);
    updateFinanceSummary();
  }
}

function handlePaidFullChange() {
  const isPaidFull = document.getElementById("admin-paid-full").checked;
  const totalPriceInput = document.getElementById("admin-total-price");
  const depositInput = document.getElementById("admin-deposit");
  
  if (isPaidFull) {
    depositInput.value = totalPriceInput.value || 0;
    depositInput.disabled = true;
  } else {
    depositInput.disabled = false;
  }
}

function loadExpenses() {
  const localData = localStorage.getItem("depto_expenses_backup");
  if (localData) {
    expenses = JSON.parse(localData);
  } else {
    expenses = [
      { id: 1, date: "2026-08-10", category: "Otros", desc: "Compra sábanas y toallas", amount: 15000 },
      { id: 2, date: "2026-08-11", category: "Mantenimiento", desc: "Reparación cerradura", amount: 8000 }
    ];
    saveExpenses();
  }
}

function saveExpenses() {
  localStorage.setItem("depto_expenses_backup", JSON.stringify(expenses));
}

function populateFinanceYears() {
  const yearSelect = document.getElementById("finance-year");
  if (!yearSelect) return;
  
  const years = new Set();
  years.add(new Date().getFullYear());
  
  bookings.forEach(b => {
    if (b && b.date && typeof b.date === 'string' && b.date !== "config" && b.date !== "analytics") {
      const y = parseInt(b.date.split("-")[0]);
      if (y) years.add(y);
    }
  });
  
  expenses.forEach(e => {
    if (e && e.date && typeof e.date === 'string') {
      const y = parseInt(e.date.split("-")[0]);
      if (y) years.add(y);
    }
  });
  
  const currentVal = yearSelect.value;
  yearSelect.innerHTML = "";
  
  Array.from(years).sort((a, b) => b - a).forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.innerText = y;
    yearSelect.appendChild(opt);
  });
  
  if (currentVal && Array.from(years).map(String).includes(currentVal)) {
    yearSelect.value = currentVal;
  }
}

function updateFinanceSummary() {
  const yearSelect = document.getElementById("finance-year");
  const monthSelect = document.getElementById("finance-month");
  if (!yearSelect || !monthSelect) return;

  const yearVal = parseInt(yearSelect.value);
  const monthVal = monthSelect.value;

  const decryptedBookingsList = getDecryptedBookings();
  let filteredBookings = decryptedBookingsList.filter(b => {
    if (!b || !b.date || typeof b.date !== 'string') return false;
    if (b.date === "config" || b.date === "analytics") return false;
    const [y, m, d] = b.date.split("-").map(Number);
    if (y !== yearVal) return false;
    if (monthVal !== "all" && (m - 1) !== parseInt(monthVal)) return false;
    return true;
  });
  
  let filteredExpenses = expenses.filter(e => {
    if (!e || !e.date || typeof e.date !== 'string') return false;
    const [y, m, d] = e.date.split("-").map(Number);
    if (y !== yearVal) return false;
    if (monthVal !== "all" && (m - 1) !== parseInt(monthVal)) return false;
    return true;
  });
  
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const pastBookings = filteredBookings.filter(b => b.date <= todayStr);

  const cleaningCost = parseInt(localStorage.getItem("depto_cleaning_cost")) || 6000;
  const totalCleaningExpenses = pastBookings.length * cleaningCost;

  const totalIncome = filteredBookings.reduce((sum, b) => sum + (Number(b.deposit) || 0), 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) + totalCleaningExpenses;
  const netProfit = totalIncome - totalExpenses;
  
  document.getElementById("stat-total-income").innerText = `$${totalIncome.toLocaleString()}`;
  document.getElementById("stat-total-expenses").innerText = `$${totalExpenses.toLocaleString()}`;
  
  const netEl = document.getElementById("stat-net-profit");
  netEl.innerText = `$${netProfit.toLocaleString()}`;
  if (netProfit >= 0) {
    netEl.style.color = "var(--success)";
  } else {
    netEl.style.color = "var(--danger)";
  }

  // Se inyecta nota dinámica de gastos de limpieza si el elemento existe en HTML
  const cleanNote = document.getElementById("finance-cleaning-note");
  if (cleanNote) {
    cleanNote.innerHTML = `<i class="fa-solid fa-broom"></i> Limpieza: $${totalCleaningExpenses.toLocaleString()} (${pastBookings.length} reservas concluidas x $${cleaningCost.toLocaleString()})`;
  }

  if (typeof renderExpenses === "function") {
    renderExpenses();
  }
  if (typeof renderFinanceChart === "function") {
    renderFinanceChart(yearVal);
  }
}

function handleAdminAddExpense(event) {
  event.preventDefault();
  const editIdVal = document.getElementById("expense-edit-id").value;
  const date = document.getElementById("expense-date").value;
  const category = document.getElementById("expense-category").value;
  const desc = document.getElementById("expense-desc").value.trim();
  const amount = parseInt(document.getElementById("expense-amount").value) || 0;

  if (editIdVal) {
    const expenseId = parseInt(editIdVal);
    const idx = expenses.findIndex(e => e.id === expenseId);
    if (idx !== -1) {
      expenses[idx].date = date;
      expenses[idx].category = category;
      expenses[idx].desc = desc;
      expenses[idx].amount = amount;
    }
    cancelExpenseEdit();
  } else {
    const newExpense = {
      id: Date.now(),
      date,
      category,
      desc,
      amount
    };
    expenses.push(newExpense);
    document.getElementById("expense-desc").value = "";
    document.getElementById("expense-amount").value = "";
  }

  saveExpenses();
  renderExpenses();
  updateFinanceSummary();
}

function deleteExpense(id) {
  if (confirm("¿Seguro que deseas eliminar este gasto?")) {
    expenses = expenses.filter(e => e.id !== id);
    saveExpenses();
    renderExpenses();
    updateFinanceSummary();
  }
}

function renderExpenses() {
  const tbody = document.getElementById("admin-expenses-list");
  if (!tbody) return;
  tbody.innerHTML = "";

  const yearSelect = document.getElementById("finance-year");
  const monthSelect = document.getElementById("finance-month");
  if (!yearSelect || !monthSelect) return;

  const yearVal = parseInt(yearSelect.value);
  const monthVal = monthSelect.value;

  let filtered = expenses.filter(e => {
    if (!e || !e.date || typeof e.date !== 'string') return false;
    const [y, m, d] = e.date.split("-").map(Number);
    if (y !== yearVal) return false;
    if (monthVal !== "all" && (m - 1) !== parseInt(monthVal)) return false;
    return true;
  });

  const sortedExpenses = filtered.sort((a, b) => b.date.localeCompare(a.date));

  if (sortedExpenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-secondary">No hay gastos registrados en este período.</td></tr>`;
    return;
  }

  sortedExpenses.forEach(e => {
    const tr = document.createElement("tr");
    const formattedDate = e.date.split("-").reverse().join("/");
    tr.innerHTML = `
      <td>${formattedDate}</td>
      <td><span class="badge badge-warning">${e.category}</span></td>
      <td>${e.desc}</td>
      <td><strong>$${e.amount.toLocaleString()}</strong></td>
      <td>
        <div class="btn-group-row" style="display:flex; gap:4px;">
          <button class="btn btn-sm btn-outline-primary" onclick="editExpense(${e.id})" style="width:30px; height:30px; padding:0;"><i class="fa-regular fa-pen-to-square"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteExpense(${e.id})" style="width:30px; height:30px; padding:0;"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function editExpense(id) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  
  document.getElementById("expense-edit-id").value = e.id;
  document.getElementById("expense-date").value = e.date;
  document.getElementById("expense-category").value = e.category;
  document.getElementById("expense-desc").value = e.desc;
  document.getElementById("expense-amount").value = e.amount;
  
  document.getElementById("expense-form-title").innerText = "Editar Gasto";
  document.getElementById("expense-submit-btn").innerText = "Guardar Cambios";
  
  const cancelBtn = document.getElementById("expense-cancel-edit-btn");
  if (cancelBtn) cancelBtn.classList.remove("hidden");
  
  const formEl = document.getElementById("admin-expense-form");
  if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelExpenseEdit() {
  document.getElementById("expense-edit-id").value = "";
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.getElementById("expense-date").value = todayStr;
  document.getElementById("expense-category").value = "Limpieza";
  document.getElementById("expense-desc").value = "";
  document.getElementById("expense-amount").value = "";
  
  document.getElementById("expense-form-title").innerText = "Registrar Nuevo Gasto";
  document.getElementById("expense-submit-btn").innerText = "Agregar Gasto";
  
  const cancelBtn = document.getElementById("expense-cancel-edit-btn");
  if (cancelBtn) cancelBtn.classList.add("hidden");
}

// --- CONEXIÓN SUPABASE Y REPORTES ---
function handleSupabaseSave(event) {
  event.preventDefault();
  const rawUrl = document.getElementById("sb-url").value.trim();
  const key = document.getElementById("sb-key").value.trim();

  const normalizedUrl = normalizeSupabaseUrl(rawUrl);

  localStorage.setItem("depto_sb_url", normalizedUrl);
  localStorage.setItem("depto_sb_key", key);
  
  supabaseUrl = normalizedUrl;
  supabaseKey = key;

  alert("Configuración de base de datos en la nube guardada. Recargando...");
  initApp();
}

function handleImportJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const importedBookings = JSON.parse(e.target.result);
      if (!Array.isArray(importedBookings)) {
        alert("El archivo JSON debe contener un arreglo de reservas.");
        return;
      }

      if (confirm(`¿Deseas importar ${importedBookings.length} reservas? Se reemplazarán las actuales.`)) {
        bookings = importedBookings;
        localStorage.setItem("depto_bookings_backup", JSON.stringify(bookings));

        if (supabaseUrl && supabaseKey) {
          try {
            console.log("Limpiando Supabase...");
            await fetch(`${supabaseUrl}/rest/v1/bookings?id=gt.0`, {
              method: "DELETE",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            });
            
            const normalizedBookings = bookings.map(b => ({
              date: b.date || "",
              slot: b.slot || "full",
              name: b.name || "",
              phone: b.phone || "",
              totalPrice: b.totalPrice !== undefined ? String(b.totalPrice) : "0",
              deposit: b.deposit !== undefined ? String(b.deposit) : "0",
              notes: b.notes || "",
              isEncrypted: b.isEncrypted !== undefined ? b.isEncrypted : false,
              isGCal: b.isGCal !== undefined ? b.isGCal : false
            }));

            console.log("Insertando en Supabase...");
            await fetch(`${supabaseUrl}/rest/v1/bookings`, {
              method: "POST",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(normalizedBookings)
            });
          } catch (err) {
            console.error("Error al sincronizar con Supabase durante importación:", err);
          }
        }
        
        alert("Importación realizada.");
        initApp();
      }
    } catch (err) {
      alert("Error al leer el archivo JSON: " + err.message);
    }
  };
  reader.readAsText(file);
}

function downloadExpensesJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(expenses, null, 2));
  const link = document.createElement("a");
  link.setAttribute("href", dataStr);
  link.setAttribute("download", "gastos_alojamiento.json");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadExpensesCSV() {
  let csvContent = "\uFEFF"; // BOM para acentos en Excel
  csvContent += "Fecha,Categoria,Descripcion,Monto\n";
  
  expenses.forEach(e => {
    const formattedDate = e.date.split("-").reverse().join("/");
    csvContent += `"${formattedDate}","${e.category}","${e.desc.replace(/"/g, '""')}","${e.amount}"\n`;
  });
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "reporte_gastos_departamentos.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// --- SISTEMA DE CONFIGURACIÓN DE WIFI ---
let wifiSSID = "";
let wifiPass = "";

function loadWifiConfig() {
  const wifiRecord = bookings.find(b => b.date === "config" && b.slot === "wifi");
  if (wifiRecord) {
    const key = SECRET_KEY;
    wifiSSID = decrypt(wifiRecord.name, key);
    wifiPass = decrypt(wifiRecord.phone, key);
    
    const inputSSID = document.getElementById("admin-wifi-ssid");
    const inputPass = document.getElementById("admin-wifi-pass");
    if (inputSSID) inputSSID.value = wifiSSID;
    if (inputPass) inputPass.value = wifiPass;
  }
}

async function handleWifiSave(event) {
  event.preventDefault();
  const ssid = document.getElementById("admin-wifi-ssid").value.trim();
  const pass = document.getElementById("admin-wifi-pass").value.trim();

  const newWifiRecord = {
    date: "config",
    slot: "wifi",
    name: encrypt(ssid),
    phone: encrypt(pass),
    totalPrice: encrypt("0"),
    deposit: encrypt("0"),
    notes: encrypt(""),
    isEncrypted: true,
    isGCal: false
  };

  bookings = bookings.filter(b => !(b.date === "config" && b.slot === "wifi"));
  await saveBooking(newWifiRecord);
  
  wifiSSID = ssid;
  wifiPass = pass;
  
  alert("Configuración de WiFi guardada y sincronizada correctamente.");
}

function openWifiModal() {
  const wifiRecord = bookings.find(b => b.date === "config" && b.slot === "wifi");
  const infoBox = document.getElementById("wifi-info-box");
  const noConfigBox = document.getElementById("wifi-no-config-box");
  const modal = document.getElementById("wifi-modal");
  
  if (wifiRecord) {
    const key = SECRET_KEY;
    const ssid = decrypt(wifiRecord.name, key);
    const pass = decrypt(wifiRecord.phone, key);
    
    document.getElementById("wifi-display-ssid").innerText = ssid;
    document.getElementById("wifi-display-pass").innerText = pass;
    
    const qrData = encodeURIComponent(`WIFI:S:${ssid};T:WPA;P:${pass};;`);
    document.getElementById("wifi-qr-img").src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}`;
    
    infoBox.classList.remove("hidden");
    noConfigBox.classList.add("hidden");
  } else {
    infoBox.classList.add("hidden");
    noConfigBox.classList.remove("hidden");
  }
  
  modal.classList.remove("hidden");
}

function closeWifiModal() {
  document.getElementById("wifi-modal").classList.add("hidden");
}

function closeWifiModalOnBackdrop(event) {
  if (event.target.id === "wifi-modal") {
    closeWifiModal();
  }
}

// --- TURISMO EN MALARGÜE ---
// Lista de atractivos turísticos configurables libremente
// Se pueden enlazar videos de YouTube o rutas de videos locales.
const tourismAttractions = [
  {
    title: "La Payunia",
    description: "Un territorio único en el mundo con más de 800 conos volcánicos, campos de lava negra y paisajes lunares espectaculares. Ideal para realizar excursiones en vehículos 4x4 y avistamiento de fauna autóctona.",
    image: "./assets/turismo-payunia.jpg",
    video: "" // Para agregar un video, coloca el enlace aquí (ej: "https://www.youtube.com/watch?v=..." o "./assets/video.mp4")
  },
  {
    title: "Caverna de las Brujas",
    description: "Una asombrosa caverna subterránea tallada por el agua a lo largo de miles de años. Su interior está decorado con estalactitas y estalagmitas que crean figuras fantásticas. Se recorre obligatoriamente con un guía oficial.",
    image: "./assets/turismo-brujas.jpg",
    video: ""
  },
  {
    title: "Valle Hermoso",
    description: "Ubicado en el corazón de la Cordillera de los Andes, este valle es famoso por sus lagunas de aguas turquesas rodeadas de montañas gigantes. Cuenta con termas naturales, cabalgatas, senderismo y un parador de comidas típicas.",
    image: "./assets/turismo-valle.jpg",
    video: ""
  },
  {
    title: "Laguna de la Niña Encantada",
    description: "Un piletón natural de aguas cristalinas alimentado por ríos subterráneos, rodeado de una antigua colada de lava. Sus leyendas aborígenes y su color verde esmeralda la convierten en una visita obligada camino a Las Leñas.",
    image: "./assets/turismo-laguna.jpg",
    video: ""
  }
];

function openTourismModal() {
  const modal = document.getElementById("tourism-modal");
  const listEl = document.getElementById("tourism-content-list");
  if (!modal || !listEl) return;

  listEl.innerHTML = "";

  tourismAttractions.forEach(item => {
    const card = document.createElement("div");
    // Estilos para las tarjetas de turismo
    card.style.border = "1px solid var(--border)";
    card.style.borderRadius = "12px";
    card.style.background = "var(--bg-primary)";
    card.style.overflow = "hidden";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.marginBottom = "8px";

    let mediaHtml = "";
    if (item.video) {
      if (item.video.includes("youtube.com") || item.video.includes("youtu.be")) {
        // Embed de YouTube
        let embedUrl = item.video;
        if (item.video.includes("watch?v=")) {
          const videoId = item.video.split("v=")[1].split("&")[0];
          embedUrl = `https://www.youtube.com/embed/${videoId}`;
        } else if (item.video.includes("youtu.be/")) {
          const videoId = item.video.split("youtu.be/")[1].split("?")[0];
          embedUrl = `https://www.youtube.com/embed/${videoId}`;
        }
        mediaHtml = `
          <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; width:100%;">
            <iframe src="${embedUrl}" style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" allowfullscreen></iframe>
          </div>
        `;
      } else {
        // Video Local
        mediaHtml = `
          <div style="width:100%; background:#000;">
            <video controls style="width:100%; display:block;" poster="${item.image || ''}">
              <source src="${item.video}" type="video/mp4">
              Tu navegador no soporta este reproductor de video.
            </video>
          </div>
        `;
      }
    } else if (item.image) {
      mediaHtml = `
        <div style="width:100%; height:180px; overflow:hidden; background: var(--bg-secondary);">
          <img src="${item.image}" onerror="this.src='https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=80'" style="width:100%; height:100%; object-fit:cover; display:block;" alt="${item.title}">
        </div>
      `;
    }

    card.innerHTML = `
      ${mediaHtml}
      <div style="padding: 14px;">
        <h4 style="color: var(--accent); margin: 0 0 6px 0; font-size: 15px; font-weight:600;">${item.title}</h4>
        <p class="text-secondary" style="margin: 0; line-height: 1.5; font-size: 12.5px;">${item.description}</p>
      </div>
    `;
    listEl.appendChild(card);
  });

  modal.classList.remove("hidden");
}

function closeTourismModal() {
  document.getElementById("tourism-modal").classList.add("hidden");
  // Detener la reproducción de cualquier video al cerrar deteniendo y recargando el contenido
  document.getElementById("tourism-content-list").innerHTML = "";
}

function closeTourismModalOnBackdrop(event) {
  if (event.target.id === "tourism-modal") {
    closeTourismModal();
  }
}

// --- GUÍA LOCAL Y RECOMENDACIONES (GPS) ---
// Lista de lugares recomendados configurables
const recommendedPlaces = [
  {
    name: "La Posta Parrilla",
    description: "Excelente parrilla argentina con carnes de primer nivel, chivito malargüino y muy buenas pastas artesanales. Ambiente familiar y tradicional.",
    category: "comer",
    coords: "-35.474668,-69.585721"
  },
  {
    name: "Cervecería Pircas",
    description: "Cervezas artesanales tiradas de producción local, excelentes picadas, hamburguesas y pizzas. El punto de encuentro ideal para la noche.",
    category: "cerveza",
    coords: "-35.472851,-69.584102"
  },
  {
    name: "Café de la Plaza",
    description: "El lugar perfecto para desayunar o merendar. Café de especialidad, pastelería casera y un ambiente súper cálido frente a la plaza principal.",
    category: "comer",
    coords: "-35.475294,-69.586111"
  },
  {
    name: "Observatorio Pierre Auger",
    description: "Centro científico de renombre mundial que estudia rayos cósmicos. Ofrece visitas guiadas interactivas gratuitas ideales para hacer con la familia.",
    category: "interes",
    coords: "-35.483120,-69.587890"
  },
  {
    name: "Criadero de Truchas Cuyam-Co",
    description: "Ubicado a pocos kilómetros del centro, es un hermoso paseo donde puedes ver el proceso de crianza de truchas y degustar platos frescos en su restaurant.",
    category: "interes",
    coords: "-35.534211,-69.591244"
  }
];

function openPlacesModal() {
  const modal = document.getElementById("places-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  
  // Renderizar por defecto la categoría 'todos'
  renderPlaces("todos");
}

function renderPlaces(categoryFilter) {
  const listEl = document.getElementById("places-content-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const filtered = categoryFilter === "todos" 
    ? recommendedPlaces 
    : recommendedPlaces.filter(p => p.category === categoryFilter);

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="text-secondary text-sm" style="text-align:center; padding: 20px;">No hay lugares registrados en esta categoría.</p>`;
    return;
  }

  filtered.forEach(place => {
    const card = document.createElement("div");
    card.style.border = "1px solid var(--border)";
    card.style.borderRadius = "12px";
    card.style.background = "var(--bg-primary)";
    card.style.padding = "14px";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "8px";

    // Icono según la categoría
    let categoryIcon = "📍";
    if (place.category === "comer") categoryIcon = "🍴";
    if (place.category === "cerveza") categoryIcon = "🍺";

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <h4 style="color:var(--text-primary); margin:0; font-size:13.5px; font-weight:600;">${categoryIcon} ${place.name}</h4>
      </div>
      <p class="text-secondary" style="margin:0; font-size:12px; line-height:1.4;">${place.description}</p>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${place.coords}" target="_blank" class="btn btn-outline-primary btn-sm" style="display:inline-flex; align-items:center; justify-content:center; gap:6px; margin:4px 0 0 0; padding:6px 12px; text-decoration:none; font-size:11px; align-self:flex-start; border-radius:8px;">
        <i class="fa-solid fa-location-arrow"></i> ¿Cómo llegar? (Google Maps)
      </a>
    `;
    listEl.appendChild(card);
  });
}

function filterPlaces(category, buttonEl) {
  // Cambiar estilo de botón activo
  const buttons = buttonEl.parentNode.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.style.background = 'transparent';
    btn.style.color = 'var(--text-secondary)';
    btn.style.borderColor = 'var(--border)';
  });
  buttonEl.style.background = 'var(--accent)';
  buttonEl.style.color = '#fff';
  buttonEl.style.borderColor = 'var(--accent)';

  renderPlaces(category);
}

function closePlacesModal() {
  document.getElementById("places-modal").classList.add("hidden");
}

function closePlacesModalOnBackdrop(event) {
  if (event.target.id === "places-modal") {
    closePlacesModal();
  }
}

// --- NORMAS DE CONVIVENCIA ---
function openRulesModal() {
  const modal = document.getElementById("rules-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeRulesModal() {
  const modal = document.getElementById("rules-modal");
  if (modal) modal.classList.add("hidden");
}

function closeRulesModalOnBackdrop(event) {
  if (event.target.id === "rules-modal") {
    closeRulesModal();
  }
}

// --- DIRECCIONAMIENTO DE MAPAS (GPS) ---
function irAlAlojamiento(event) {
  if (event) event.preventDefault();
  const lat = MAP_LAT;
  const lon = MAP_LON;
  const label = encodeURIComponent(ALOJAMIENTO_NAME);
  
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isAndroid = /Android/.test(navigator.userAgent);
  
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  
  if (isIOS) {
    const appUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;
    const start = Date.now();
    window.location.href = appUrl;
    
    setTimeout(() => {
      if (Date.now() - start < 2000) {
        window.open(webUrl, '_blank');
      }
    }, 1500);
  } else if (isAndroid) {
    const geoUrl = `geo:${lat},${lon}?q=${lat},${lon}(${label})`;
    window.location.href = geoUrl;
    setTimeout(() => {
      window.open(webUrl, '_blank');
    }, 1500);
  } else {
    window.open(webUrl, '_blank');
  }
}

// --- DETECTAR FOTOS DINÁMICAS (CARRUSEL E INSTALACIONES) ---
async function initCarouselGallery() {
  const defaultSlides = [
    { url: "./assets/depto-main.jpg", title: "Malargüe al Sur", desc: "Departamentos confortables en el corazón de Malargüe." },
    { url: "./assets/depto-living.jpg", title: "Estancia Confortable", desc: "Living comedor amplio equipado para 5 personas." }
  ];

  const maxPhotos = 12;
  const scanPromises = [];

  for (let i = 1; i <= maxPhotos; i++) {
    const url = `./assets/foto${i}.jpg`;
    scanPromises.push(
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ url, title: `Alojamiento ${i}`, desc: "Interiores e instalaciones de nuestros departamentos." });
        img.onerror = () => resolve(null);
        img.src = url;
      })
    );
  }

  const scannedResults = await Promise.all(scanPromises);
  const validScanned = scannedResults.filter(slide => slide !== null);
  const allSlides = [...defaultSlides, ...validScanned];

  if (validScanned.length > 0) {
    const track = document.getElementById("carousel-track");
    const indicators = document.getElementById("carousel-indicators");
    
    if (track && indicators) {
      track.innerHTML = "";
      indicators.innerHTML = "";

      allSlides.forEach((slide, index) => {
        const slideEl = document.createElement("div");
        slideEl.className = `carousel-slide ${index === 0 ? 'active' : ''}`;
        slideEl.innerHTML = `
          <img src="${slide.url}" alt="${slide.title}">
          <div class="slide-caption">
            <h3>${slide.title}</h3>
            <p>${slide.desc}</p>
          </div>
        `;
        track.appendChild(slideEl);

        const indEl = document.createElement("span");
        indEl.className = `indicator ${index === 0 ? 'active' : ''}`;
        indEl.addEventListener("click", () => setCarouselSlide(index));
        indicators.appendChild(indEl);
      });
      currentCarouselIndex = 0;
    }
  }
}

// --- GALERÍA SERVICIOS LIGHTBOX ---
let currentGallerySlides = [];
let currentGalleryIndex = 0;

async function openServiceGallery(serviceId, serviceTitle) {
  const modal = document.getElementById("gallery-modal");
  const titleEl = document.getElementById("gallery-modal-title");
  const track = document.getElementById("gallery-modal-track");
  const indicators = document.getElementById("gallery-modal-indicators");
  
  if (!modal || !track || !indicators) return;
  
  titleEl.innerHTML = `<i class="fa-solid fa-images"></i> Galería: ${serviceTitle}`;
  track.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-secondary); gap: 10px;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:24px; color:var(--accent);"></i>
      <span style="font-size:12px;">Escaneando assets...</span>
    </div>
  `;
  indicators.innerHTML = "";
  modal.classList.remove("hidden");
  
  const maxPhotos = 8;
  const scanPromises = [];
  
  for (let i = 1; i <= maxPhotos; i++) {
    const url = `./assets/${serviceId}${i}.jpg`;
    scanPromises.push(
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => resolve(null);
        img.src = url;
      })
    );
  }
  
  const results = await Promise.all(scanPromises);
  const validUrls = results.filter(url => url !== null);
  
  if (validUrls.length === 0) {
    let defaultUrl = "./assets/depto-main.jpg";
    if (serviceId === "habitaciones") defaultUrl = "./assets/depto-hab1.jpg";
    if (serviceId === "servicios") defaultUrl = "./assets/depto-living.jpg";
    if (serviceId === "equipamiento") defaultUrl = "./assets/depto-cocina.jpg";
    validUrls.push(defaultUrl);
  }
  
  track.innerHTML = "";
  currentGallerySlides = validUrls;
  currentGalleryIndex = 0;
  
  currentGallerySlides.forEach((url, index) => {
    const slideEl = document.createElement("div");
    slideEl.className = `gallery-slide ${index === 0 ? 'active' : ''}`;
    slideEl.innerHTML = `<img src="${url}" alt="${serviceTitle} ${index + 1}">`;
    track.appendChild(slideEl);
    
    const indEl = document.createElement("span");
    indEl.className = `gallery-indicator ${index === 0 ? 'active' : ''}`;
    indEl.addEventListener("click", () => setGallerySlide(index));
    indicators.appendChild(indEl);
  });
}

function closeServiceGallery() {
  const modal = document.getElementById("gallery-modal");
  if (modal) modal.classList.add("hidden");
}

function closeServiceGalleryOnBackdrop(event) {
  if (event.target.id === "gallery-modal") {
    closeServiceGallery();
  }
}

function setGallerySlide(index) {
  if (index < 0 || index >= currentGallerySlides.length) return;
  currentGalleryIndex = index;
  
  const slides = document.querySelectorAll(".gallery-slide");
  const indicators = document.querySelectorAll(".gallery-indicator");
  
  slides.forEach((slide, i) => {
    slide.classList.toggle("active", i === index);
  });
  
  indicators.forEach((indicator, i) => {
    indicator.classList.toggle("active", i === index);
  });
}

function nextGallerySlide() {
  if (currentGallerySlides.length <= 1) return;
  setGallerySlide((currentGalleryIndex + 1) % currentGallerySlides.length);
}

function prevGallerySlide() {
  if (currentGallerySlides.length <= 1) return;
  setGallerySlide((currentGalleryIndex - 1 + currentGallerySlides.length) % currentGallerySlides.length);
}

// --- ARGENTINA HOLIDAYS API ---
async function fetchHolidays(year) {
  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`);
    if (response.ok) {
      const data = await response.json();
      holidays = data.map(h => h.date);
      holidayNames = {};
      data.forEach(h => {
        holidayNames[h.date] = h.localName;
      });
      console.log(`Feriados AR ${year} cargados`, data.length);
    } else {
      throw new Error("API fallida");
    }
  } catch (err) {
    console.warn("Fallo al obtener feriados, cargando predeterminados...", err);
    const fixedHolidays = [
      { date: `${year}-01-01`, name: "Año Nuevo" },
      { date: `${year}-03-24`, name: "Día de la Memoria" },
      { date: `${year}-04-02`, name: "Día de Malvinas" },
      { date: `${year}-05-01`, name: "Día del Trabajador" },
      { date: `${year}-05-25`, name: "Revolución de Mayo" },
      { date: `${year}-06-20`, name: "Día de la Bandera" },
      { date: `${year}-07-09`, name: "Día de la Independencia" },
      { date: `${year}-08-17`, name: "Paso a la Inmortalidad del Gral. San Martín" },
      { date: `${year}-10-12`, name: "Día del Respeto a la Diversidad Cultural" },
      { date: `${year}-11-20`, name: "Día de la Soberanía Nacional" },
      { date: `${year}-12-08`, name: "Inmaculada Concepción" },
      { date: `${year}-12-25`, name: "Navidad" }
    ];
    holidays = fixedHolidays.map(h => h.date);
    holidayNames = {};
    fixedHolidays.forEach(h => {
      holidayNames[h.date] = h.name;
    });
  }
}

// --- VENTANAS DE CONTROL POST-RESERVA ---
let lastSavedBooking = null;

function showPostBookingModal(booking) {
  lastSavedBooking = booking;
  const modal = document.getElementById("post-booking-modal");
  if (!modal) return;

  const btnWa = document.getElementById("btn-post-booking-wa");
  const btnGcal = document.getElementById("btn-post-booking-gcal");

  if (booking.phone && booking.phone !== "GCal") {
    btnWa.classList.remove("hidden");
    btnWa.onclick = () => sendWhatsAppConfirmation(booking);
  } else {
    btnWa.classList.add("hidden");
  }

  btnGcal.onclick = () => addBookingToGoogleCalendar(booking);
  modal.classList.remove("hidden");
}

function closePostBookingModal() {
  document.getElementById("post-booking-modal").classList.add("hidden");
}

function sendWhatsAppConfirmation(b) {
  const formattedDate = b.date.split("-").reverse().join("/");
  let cleanPhone = b.phone ? b.phone.replace(/\D/g, '') : "";
  if (cleanPhone.length === 10) cleanPhone = "549" + cleanPhone;
  else if (cleanPhone.length === 11 && cleanPhone.startsWith("0")) cleanPhone = "549" + cleanPhone.substring(1);
  else if (cleanPhone.length === 11 && cleanPhone.startsWith("9")) cleanPhone = "54" + cleanPhone;
  else if (cleanPhone.length === 12 && cleanPhone.startsWith("54")) cleanPhone = "549" + cleanPhone.substring(2);

  const key = SECRET_KEY;
  const nameVal = b.isEncrypted ? decrypt(b.name, key) : b.name;
  const totalPriceVal = b.isEncrypted ? decrypt(b.totalPrice, key) : b.totalPrice;
  const depositVal = b.isEncrypted ? decrypt(b.deposit, key) : b.deposit;
  const balanceVal = Number(totalPriceVal) - Number(depositVal);

  const text = `🏡 *MALARGUE AL SUR DEPARTAMENTOS* 🏡\n\n` + 
               `¡Hola ${nameVal}! Le confirmamos su reserva:\n` +
               `📅 *Fecha de Ingreso:* ${formattedDate}\n` +
               `⏰ *Horario Check-in:* 14:00 hs\n` +
               `💵 *Monto Total:* $${totalPriceVal}\n` +
               `💰 *Seña Recibida:* $${depositVal}\n` +
               `👉 *Saldo Restante:* $${balanceVal}\n\n` +
               `*¡Los esperamos para una estadía excelente!*`;

  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

function addBookingToGoogleCalendar(b) {
  const dateClean = b.date.replace(/-/g, '');
  const startGCal = `${dateClean}T140000`;
  
  const checkOutDate = new Date(b.date + "T12:00:00");
  checkOutDate.setDate(checkOutDate.getDate() + 1);
  const endGCal = `${checkOutDate.getFullYear()}${String(checkOutDate.getMonth() + 1).padStart(2, '0')}${String(checkOutDate.getDate()).padStart(2, '0')}T100000`;

  const key = SECRET_KEY;
  const nameVal = b.isEncrypted ? decrypt(b.name, key) : b.name;
  const totalPriceVal = b.isEncrypted ? decrypt(b.totalPrice, key) : b.totalPrice;
  const depositVal = b.isEncrypted ? decrypt(b.deposit, key) : b.deposit;
  const notesVal = b.isEncrypted ? decrypt(b.notes, key) : b.notes;

  const gcalTitle = encodeURIComponent(`Reserva Depto: ${nameVal}`);
  const gcalDetails = encodeURIComponent(`Monto Total: $${totalPriceVal}\nSeña Cobrada: $${depositVal}\nNotas: ${notesVal}`);
  
  const gcalLink = `https://www.google.com/calendar/render?action=TEMPLATE&text=${gcalTitle}&dates=${startGCal}/${endGCal}&details=${gcalDetails}`;
  window.open(gcalLink, "_blank");
}

function openGoogleCalendarOnDate(dateStr) {
  const [year, month, day] = dateStr.split("-");
  const calendarUrl = `https://calendar.google.com/calendar/r/day/${year}/${month}/${day}`;
  window.open(calendarUrl, "_blank");
}

// --- RENDERIZADO DEL GRÁFICO FINANCIERO ---
function renderFinanceChart(yearVal) {
  const canvas = document.querySelector(".chart-canvas");
  if (!canvas) return;
  
  const decryptedBookingsList = getDecryptedBookings();
  const cleaningCost = parseInt(localStorage.getItem("depto_cleaning_cost")) || 6000;
  
  const monthlyIncome = Array(12).fill(0);
  const monthlyExpenses = Array(12).fill(0);
  const monthlyProfit = Array(12).fill(0);
  
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  decryptedBookingsList.forEach(b => {
    if (!b || !b.date || typeof b.date !== 'string') return;
    if (b.date === "config" || b.date === "analytics") return;
    const [y, m, d] = b.date.split("-").map(Number);
    if (y !== yearVal) return;
    
    const monthIndex = m - 1;
    const income = Number(b.deposit) || 0;
    monthlyIncome[monthIndex] += income;
    
    if (b.date <= todayStr) {
      monthlyExpenses[monthIndex] += cleaningCost;
    }
  });
  
  expenses.forEach(e => {
    if (!e || !e.date || typeof e.date !== 'string') return;
    const [y, m, d] = e.date.split("-").map(Number);
    if (y !== yearVal) return;
    
    const monthIndex = m - 1;
    monthlyExpenses[monthIndex] += (Number(e.amount) || 0);
  });
  
  for (let i = 0; i < 12; i++) {
    monthlyProfit[i] = monthlyIncome[i] - monthlyExpenses[i];
  }
  
  const maxVal = Math.max(...monthlyProfit.map(Math.abs), 1000);
  
  canvas.innerHTML = "";
  
  monthlyProfit.forEach((profit, idx) => {
    const col = document.createElement("div");
    col.style = "display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; position: relative; margin: 0 3px;";
    
    const pct = Math.min((Math.abs(profit) / maxVal) * 80, 80);
    
    const bar = document.createElement("div");
    bar.style.width = "100%";
    bar.style.height = `${pct}%`;
    bar.style.borderRadius = "4px 4px 0 0";
    bar.style.transition = "height 0.4s ease";
    bar.style.cursor = "pointer";
    
    if (profit >= 0) {
      bar.style.background = "linear-gradient(to top, var(--success), #34d399)";
    } else {
      bar.style.background = "linear-gradient(to top, var(--danger), #f87171)";
    }
    
    const tooltip = document.createElement("span");
    tooltip.innerText = profit !== 0 ? `$${Math.round(profit/1000)}k` : "$0";
    tooltip.style = `
      position: absolute;
      bottom: calc(${pct}% + 4px);
      font-size: 8px;
      font-weight: 700;
      color: ${profit >= 0 ? '#10b981' : '#ef4444'};
      pointer-events: none;
      white-space: nowrap;
      background: rgba(15, 23, 42, 0.6);
      padding: 1px 3px;
      border-radius: 4px;
    `;
    
    col.appendChild(tooltip);
    col.appendChild(bar);
    canvas.appendChild(col);
  });
  
  const titleEl = document.querySelector("#finance-chart-container h4");
  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-chart-column"></i> Evolución Mensual de Ganancia Neta (${yearVal})`;
  }
}

// --- SISTEMA DE CONFIGURACIÓN Y SINCRONIZACIÓN DE ICAL (BOOKING/AIRBNB) ---
function loadIcalConfig() {
  const bookingInput = document.getElementById("admin-ical-booking");
  const airbnbInput = document.getElementById("admin-ical-airbnb");
  
  const bUrl = localStorage.getItem("depto_ical_booking") || "https://ical.booking.com/v1/export?t=592cea91-6fc5-403b-bcc2-e9a53103924a";
  const aUrl = localStorage.getItem("depto_ical_airbnb") || "";
  
  if (bookingInput) bookingInput.value = bUrl;
  if (airbnbInput) airbnbInput.value = aUrl;
}

async function handleIcalSave(event) {
  if (event) event.preventDefault();
  const bookingUrl = document.getElementById("admin-ical-booking").value.trim();
  const airbnbUrl = document.getElementById("admin-ical-airbnb").value.trim();
  
  localStorage.setItem("depto_ical_booking", bookingUrl);
  localStorage.setItem("depto_ical_airbnb", airbnbUrl);
  
  alert("Enlaces iCal guardados. Sincronizando calendarios externos...");
  await syncExternalCalendars();
  alert("Sincronización externa completada con éxito.");
}

async function syncExternalCalendars() {
  const bookingUrl = localStorage.getItem("depto_ical_booking") || "https://ical.booking.com/v1/export?t=592cea91-6fc5-403b-bcc2-e9a53103924a";
  const airbnbUrl = localStorage.getItem("depto_ical_airbnb");
  
  externalBookings = []; // Limpiar sincronizaciones anteriores
  
  const syncPromises = [];
  
  if (bookingUrl) {
    syncPromises.push(fetchAndParseIcal(bookingUrl, "Booking.com"));
  }
  if (airbnbUrl) {
    syncPromises.push(fetchAndParseIcal(airbnbUrl, "Airbnb"));
  }
  
  if (syncPromises.length > 0) {
    console.log("Sincronizando canales externos...");
    await Promise.all(syncPromises);
    console.log(`Sincronización externa finalizada. Reservas importadas: ${externalBookings.length}`);
  }
}

async function fetchAndParseIcal(rawUrl, channelName) {
  try {
    // Agregar parámetro de tiempo para evitar respuestas cacheadas
    const cb = `&_cb=${Date.now()}`;
    const urlWithCb = rawUrl.includes("?") ? `${rawUrl}${cb}` : `${rawUrl}?${cb}`;
    
    // Usar proxy CORS gratuito (AllOrigins) para evitar bloqueos del navegador
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(urlWithCb)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("HTTP status " + response.status);
    const text = await response.text();
    
    // Unir líneas divididas del archivo ICS
    const unfolded = unfoldIcs(text);
    
    // Separar eventos
    const events = unfolded.split("BEGIN:VEVENT");
    
    for (let i = 1; i < events.length; i++) {
      const ev = events[i];
      const dtstartMatch = ev.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
      const dtendMatch = ev.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);
      
      if (dtstartMatch && dtendMatch) {
        const startStr = dtstartMatch[1]; // YYYYMMDD
        const endStr = dtendMatch[1];     // YYYYMMDD
        
        // Convertir a objetos Date (a las 12 del mediodía para evitar problemas de huso horario)
        const start = new Date(startStr.substring(0,4) + "-" + startStr.substring(4,6) + "-" + startStr.substring(6,8) + "T12:00:00");
        const end = new Date(endStr.substring(0,4) + "-" + endStr.substring(4,6) + "-" + endStr.substring(6,8) + "T12:00:00");
        
        // Bloquear los días de la estadía
        // (El día de salida del check-out queda libre para que pueda ingresar otro huésped)
        let current = new Date(start);
        while (current < end) {
          const yyyy = current.getFullYear();
          const mm = String(current.getMonth() + 1).padStart(2, '0');
          const dd = String(current.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;
          
          if (!externalBookings.some(eb => eb.date === dateStr)) {
            externalBookings.push({
              date: dateStr,
              slot: "full",
              name: `Reserva externa (${channelName})`,
              phone: channelName,
              totalPrice: 0,
              deposit: 0,
              notes: "Sincronizado automáticamente",
              isExternal: true
            });
          }
          current.setDate(current.getDate() + 1);
        }
      }
    }
  } catch (err) {
    console.warn(`Error al sincronizar canal ${channelName}:`, err);
  }
}

function unfoldIcs(icsText) {
  const lines = icsText.split(/\r?\n/);
  const unfolded = [];
  for (let line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (unfolded.length > 0) {
        unfolded[unfolded.length - 1] += line.slice(1);
      }
    } else {
      unfolded.push(line);
    }
  }
  return unfolded.join("\n");
}
