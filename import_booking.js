const https = require('https');

// Configuración de Supabase y Booking.com
const supabaseUrl = "https://qmavaeeivpbiefgpvxmw.supabase.co";
const supabaseKey = "sb_publishable_oxLQ78P59OXqXBj1baKyYg_4Hh5RHps";
const bookingIcalUrl = "https://ical.booking.com/v1/export?t=592cea91-6fc5-403b-bcc2-e9a53103924a";
const SECRET_KEY = "adminsur";

console.log("Iniciando descarga del calendario de Booking.com...");

// 1. Descargar el archivo iCal directamente sin proxies (evita bloqueos de CORS)
https.get(bookingIcalUrl, (res) => {
  if (res.statusCode !== 200) {
    console.error(`Error al conectar con Booking.com. Código HTTP: ${res.statusCode}`);
    process.exit(1);
  }

  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    parseAndSyncICS(data);
  });
}).on('error', (err) => {
  console.error("Error de conexión:", err.message);
  process.exit(1);
});

async function parseAndSyncICS(icsContent) {
  const datesToBlock = [];
  
  // Unir líneas divididas del archivo ICS
  const lines = icsContent.split(/\r?\n/);
  const unfoldedLines = [];
  for (let line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (unfoldedLines.length > 0) {
        unfoldedLines[unfoldedLines.length - 1] += line.slice(1);
      }
    } else {
      unfoldedLines.push(line);
    }
  }

  // Parsear eventos VEVENT
  const events = unfoldedLines.join('\n').split('BEGIN:VEVENT');
  for (let i = 1; i < events.length; i++) {
    const ev = events[i];
    const dtstartMatch = ev.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
    const dtendMatch = ev.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);

    if (dtstartMatch && dtendMatch) {
      const startStr = dtstartMatch[1]; // YYYYMMDD
      const endStr = dtendMatch[1];     // YYYYMMDD

      const start = new Date(startStr.substring(0,4) + "-" + startStr.substring(4,6) + "-" + startStr.substring(6,8) + "T12:00:00");
      const end = new Date(endStr.substring(0,4) + "-" + endStr.substring(4,6) + "-" + endStr.substring(6,8) + "T12:00:00");

      let current = new Date(start);
      while (current < end) {
        const yyyy = current.getFullYear();
        const mm = String(current.getMonth() + 1).padStart(2, '0');
        const dd = String(current.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        
        if (!datesToBlock.includes(dateStr)) {
          datesToBlock.push(dateStr);
        }
        current.setDate(current.getDate() + 1);
      }
    }
  }

  console.log(`Se encontraron ${datesToBlock.length} días ocupados en Booking.com.`);

  // Cifrar registros para Supabase
  const encryptedBookings = datesToBlock.map(dateStr => {
    return {
      date: dateStr,
      slot: "full",
      name: encrypt("Reserva de Booking.com"),
      phone: encrypt("Booking"),
      totalPrice: encrypt("0"),
      deposit: encrypt("0"),
      notes: encrypt("Sincronizado automáticamente"),
      isEncrypted: true,
      isGCal: false
    };
  });

  // Clave encriptada de "Booking" para eliminar registros viejos
  const bookingEncryptedPhone = encrypt("Booking");

  try {
    // 2. Eliminar reservas viejas de Booking.com en Supabase
    console.log("Limpiando sincronizaciones anteriores de Booking en la base de datos...");
    await makeSupabaseRequest(`/rest/v1/bookings?phone=eq.${bookingEncryptedPhone}`, 'DELETE');

    // 3. Subir las nuevas reservas a Supabase
    if (encryptedBookings.length > 0) {
      console.log("Subiendo las nuevas fechas ocupadas a Supabase...");
      await makeSupabaseRequest('/rest/v1/bookings', 'POST', encryptedBookings);
    }
    
    console.log("--------------------------------------------------");
    console.log("¡Sincronización completada con éxito!");
    console.log(`Se han bloqueado ${datesToBlock.length} días en tu calendario.`);
    console.log("--------------------------------------------------");
  } catch (err) {
    console.error("Error al sincronizar con Supabase:", err.message);
  }
}

// Helper para hacer llamadas directas a Supabase
function makeSupabaseRequest(path, method, body = null) {
  return new Promise((resolve, reject) => {
    const url = `${supabaseUrl}${path}`;
    const options = {
      method: method,
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      }
    };

    const req = https.request(url, options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`Código HTTP de error: ${res.statusCode}`));
      }
    });

    req.on('error', (e) => reject(e));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Cifrado idéntico al de app.js
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
