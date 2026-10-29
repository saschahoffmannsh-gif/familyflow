export type EntryRef = { kind: 'event' | 'todo'; id: string }
export type EntryActivity = { messages: number; images: number; audio: number }
export type ChatEntry = { title: string; kind: 'event' | 'task'; date?: string; endDate?: string; time?: string; note?: string }
export type ChatAttachment = { id: string; name: string; mime: string; size: number; duration?: number }
export type ChatMessage = { id: string; authorId: string; author: string; color: string; body: string; createdAt: string; attachment?: ChatAttachment }
export type ChatReminder = { id: string; remindAt: string; delivered: boolean }
export type ChatData = { id: string; entry: ChatEntry; messages: ChatMessage[]; hasMore: boolean; canWrite: boolean; canShare: boolean; shareToken?: string; reminders: ChatReminder[]; joined?: boolean; imported?: boolean; importedGroupId?: string; importDate?: string }
export function isCalendarDate(value: unknown): value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
 const date=new Date(`${value}T12:00:00Z`)
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value
}
export function clientId() {
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID()
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
 const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}
export const MAX_IMAGE_BYTES=10*1024*1024,MAX_AUDIO_BYTES=12*1024*1024
export function validateAttachment(mime:string,size:number,bytes:Uint8Array){
 mime=mime.split(';')[0].toLowerCase();const text=(s:number,e:number)=>String.fromCharCode(...bytes.slice(s,e))
 const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255
 :mime==='image/png'?bytes[0]===137&&text(1,4)==='PNG'
 :mime==='image/webp'?text(0,4)==='RIFF'&&text(8,12)==='WEBP'
 :mime==='image/gif'?/^GIF8[79]a$/.test(text(0,6))
 :mime==='audio/mp4'||mime==='audio/x-m4a'?text(4,8)==='ftyp'
 :mime==='audio/webm'?bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163
 :mime==='audio/ogg'?text(0,4)==='OggS'
 :mime==='audio/wav'?text(0,4)==='RIFF'&&text(8,12)==='WAVE'
 :mime==='audio/mpeg'?text(0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224):false
 if(!valid)throw new Error('Bitte wähle ein JPG, PNG, WebP, GIF oder eine unterstützte Audiodatei.')
 if(size<12||size>(mime.startsWith('image/')?MAX_IMAGE_BYTES:MAX_AUDIO_BYTES))throw new Error(mime.startsWith('image/')?'Das Bild darf höchstens 10 MB groß sein.':'Die Sprachnachricht darf höchstens 12 MB groß sein.')
 return mime
}
const escapeIcs=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
const icsDate=(s:string)=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
export function reminderCalendar(entry:ChatEntry,at:string,id:string){
 const start=new Date(at);if(!Number.isFinite(start.getTime()))throw new Error('Ungültige Erinnerungszeit.')
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Done//Erinnerung//DE','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${escapeIcs(id)}@done`,`DTSTAMP:${icsDate(new Date().toISOString())}`,`DTSTART:${icsDate(at)}`,`DTEND:${icsDate(new Date(start.getTime()+300000).toISOString())}`,`SUMMARY:${escapeIcs(`Erinnerung: ${entry.title}`)}`,`DESCRIPTION:${escapeIcs([entry.date?`Termin: ${entry.date}${entry.time?` ${entry.time}`:''}`:'',entry.note||''].filter(Boolean).join('\n'))}`,'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:PT0M',`DESCRIPTION:${escapeIcs(entry.title)}`,'END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n')
}
