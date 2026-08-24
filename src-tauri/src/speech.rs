//! Text-to-speech through the OS voices.
//!
//! WebView2 exposes no `speechSynthesis` voices, so the browser API cannot serve
//! as the zero-key TTS path — this module is the replacement. It costs no API key
//! and works offline, which keeps the "talks out of the box" promise intact
//! (spec E); ElevenLabs and friends layer on top once a key exists.
//!
//! `tts::Tts` is not `Send`, so it is created on and never leaves a dedicated
//! thread. Commands reach it over a channel.

use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

enum Cmd {
    Speak(String),
    Stop,
}

pub struct Speech {
    tx: Mutex<Option<Sender<Cmd>>>,
    /// Why TTS is unavailable, for the settings UI to show rather than failing mutely.
    error: Mutex<Option<String>>,
}

impl Speech {
    pub fn new() -> Self {
        let (tx, rx) = channel::<Cmd>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();

        std::thread::spawn(move || {
            let mut tts = match tts::Tts::default() {
                Ok(t) => {
                    let _ = ready_tx.send(Ok(()));
                    t
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            // Owns the synthesiser for the life of the app; dropping it would cut
            // off any utterance still playing.
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    // interrupt = true: a new reply supersedes whatever is still speaking.
                    Cmd::Speak(text) => {
                        if let Err(e) = tts.speak(text, true) {
                            eprintln!("[tts] speak failed: {e}");
                        }
                    }
                    Cmd::Stop => {
                        let _ = tts.stop();
                    }
                }
            }
        });

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Speech {
                tx: Mutex::new(Some(tx)),
                error: Mutex::new(None),
            },
            Ok(Err(e)) => Speech {
                tx: Mutex::new(None),
                error: Mutex::new(Some(e)),
            },
            Err(_) => Speech {
                tx: Mutex::new(None),
                error: Mutex::new(Some("speech engine did not initialise within 5s".into())),
            },
        }
    }

    fn send(&self, cmd: Cmd) -> Result<(), String> {
        let guard = self.tx.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(tx) => tx.send(cmd).map_err(|e| e.to_string()),
            None => Err(self
                .error
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_else(|| "speech unavailable".into())),
        }
    }
}

impl Default for Speech {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub fn speech_available(state: tauri::State<'_, Speech>) -> bool {
    state.tx.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn speak(state: tauri::State<'_, Speech>, text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }
    state.send(Cmd::Speak(text))
}

#[tauri::command]
pub fn stop_speaking(state: tauri::State<'_, Speech>) -> Result<(), String> {
    state.send(Cmd::Stop)
}
