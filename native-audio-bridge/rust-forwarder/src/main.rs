use anyhow::Result;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::f32::consts::PI;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const HEADER_SIZE: usize = 24;

#[derive(Parser, Debug, Clone)]
#[command(name = "qd-audio-forwarder")]
#[command(about = "QuokkaDispatcher native audio packet forwarder")]
struct Args {
    #[arg(long, default_value = "ws://127.0.0.1:30130/voice-relay/ingest")]
    endpoint: String,

    #[arg(long, default_value = "pcm16")]
    codec: String,

    #[arg(long, default_value_t = 1)]
    source: u8,

    #[arg(long, default_value_t = 2)]
    channels: u8,

    #[arg(long, default_value_t = 48_000)]
    sample_rate: u16,

    #[arg(long, default_value_t = 20)]
    frame_ms: u16,

    #[arg(long)]
    process_id: Option<u32>,

    #[arg(long, default_value_t = true)]
    include_tree: bool,
}

#[derive(Debug, Deserialize)]
struct VoiceControlEnvelope {
    #[serde(rename = "type")]
    msg_type: String,
    data: Option<VoiceControlData>,
}

#[derive(Debug, Deserialize)]
struct VoiceControlData {
    source: Option<u8>,
}

#[derive(Clone, Copy)]
enum Codec {
    Opus = 1,
    Pcm16Le = 2,
}

impl Codec {
    fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "opus" => Codec::Opus,
            _ => Codec::Pcm16Le,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn build_packet(
    source: u8,
    codec: Codec,
    channels: u8,
    sample_rate: u16,
    sequence: u32,
    payload: &[u8],
) -> Vec<u8> {
    let payload_len = payload.len().min(u16::MAX as usize) as u16;

    let mut out = Vec::with_capacity(HEADER_SIZE + payload_len as usize);
    out.extend_from_slice(b"QDAV");
    out.push(1); // version
    out.push(source);
    out.push(codec as u8);
    out.push(channels);
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&payload_len.to_le_bytes());
    out.extend_from_slice(&sequence.to_le_bytes());
    out.extend_from_slice(&now_ms().to_le_bytes());
    out.extend_from_slice(&payload[..payload_len as usize]);
    out
}

fn generate_pcm_sine(channels: u8, sample_rate: u16, frame_ms: u16, phase: &mut f32) -> Vec<u8> {
    let frames_per_packet = (sample_rate as u32 * frame_ms as u32 / 1000) as usize;
    let mut pcm = Vec::<u8>::with_capacity(frames_per_packet * channels as usize * 2);

    let freq_hz = 700.0_f32;
    let phase_step = (2.0 * PI * freq_hz) / sample_rate as f32;

    for _ in 0..frames_per_packet {
        let sample = (*phase).sin() * 0.20;
        let i16_sample = (sample * i16::MAX as f32) as i16;
        for _ in 0..channels {
            pcm.extend_from_slice(&i16_sample.to_le_bytes());
        }
        *phase += phase_step;
        if *phase > 2.0 * PI {
            *phase -= 2.0 * PI;
        }
    }

    pcm
}

#[cfg(windows)]
mod capture {
    use super::Args;
    use std::collections::VecDeque;
    use std::ffi::OsStr;
    use std::thread;
    use std::time::Duration;
    use sysinfo::{ProcessesToUpdate, System};
    use tokio::sync::mpsc;
    use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat, initialize_mta};

    fn find_fivem_pid(system: &System) -> Option<u32> {
        let exact = [
            "FiveM.exe",
            "FiveM_b2545_GTAProcess.exe",
            "FiveM_GTAProcess.exe",
        ];

        for name in exact {
            if let Some(process) = system.processes_by_exact_name(OsStr::new(name)).next() {
                return Some(process.pid().as_u32());
            }
        }

        for process in system.processes().values() {
            let lower = process.name().to_string_lossy().to_lowercase();
            if lower.contains("fivem") {
                return Some(process.pid().as_u32());
            }
        }

        None
    }

    fn resolve_pid(config: &Args, system: &mut System) -> u32 {
        if let Some(pid) = config.process_id {
            return pid;
        }

        loop {
            system.refresh_processes(ProcessesToUpdate::All, true);
            if let Some(pid) = find_fivem_pid(system) {
                return pid;
            }
            eprintln!("[AudioForwarder] FiveM process not found yet, retrying...");
            thread::sleep(Duration::from_millis(1500));
        }
    }

    pub fn spawn_capture(config: Args, tx: mpsc::Sender<Vec<u8>>) {
        thread::spawn(move || {
            let mut system = System::new_all();

            loop {
                let pid = resolve_pid(&config, &mut system);
                eprintln!("[AudioForwarder] Using loopback process id: {pid}");

                let desired_format =
                    WaveFormat::new(16, 16, &SampleType::Int, config.sample_rate, config.channels, None);
                let blockalign = desired_format.get_blockalign() as usize;
                let frames_per_chunk =
                    (config.sample_rate as usize * config.frame_ms as usize / 1000).max(1);
                let chunk_bytes = frames_per_chunk * blockalign;

                if let Err(err) = initialize_mta() {
                    eprintln!("[AudioForwarder] initialize_mta failed: {err}");
                    thread::sleep(Duration::from_millis(1500));
                    continue;
                }

                let mut audio_client = match AudioClient::new_application_loopback_client(pid, config.include_tree) {
                    Ok(client) => client,
                    Err(err) => {
                        eprintln!("[AudioForwarder] Loopback client create failed: {err}");
                        thread::sleep(Duration::from_millis(1500));
                        continue;
                    }
                };

                let mode = StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: 200_000,
                };

                if let Err(err) = audio_client.initialize_client(&desired_format, &Direction::Capture, &mode) {
                    eprintln!("[AudioForwarder] initialize_client failed: {err}");
                    thread::sleep(Duration::from_millis(1500));
                    continue;
                }

                let h_event = match audio_client.set_get_eventhandle() {
                    Ok(ev) => ev,
                    Err(err) => {
                        eprintln!("[AudioForwarder] set_get_eventhandle failed: {err}");
                        thread::sleep(Duration::from_millis(1500));
                        continue;
                    }
                };

                let capture_client = match audio_client.get_audiocaptureclient() {
                    Ok(client) => client,
                    Err(err) => {
                        eprintln!("[AudioForwarder] get_audiocaptureclient failed: {err}");
                        thread::sleep(Duration::from_millis(1500));
                        continue;
                    }
                };

                if let Err(err) = audio_client.start_stream() {
                    eprintln!("[AudioForwarder] start_stream failed: {err}");
                    thread::sleep(Duration::from_millis(1500));
                    continue;
                }

                let mut queue = VecDeque::<u8>::with_capacity(chunk_bytes.saturating_mul(8));
                eprintln!("[AudioForwarder] Loopback capture started");

                loop {
                    if let Err(err) = capture_client.read_from_device_to_deque(&mut queue) {
                        eprintln!("[AudioForwarder] read_from_device_to_deque failed: {err}");
                        break;
                    }

                    while queue.len() >= chunk_bytes {
                        let mut chunk = vec![0u8; chunk_bytes];
                        for byte in &mut chunk {
                            if let Some(sample) = queue.pop_front() {
                                *byte = sample;
                            }
                        }

                        if tx.blocking_send(chunk).is_err() {
                            let _ = audio_client.stop_stream();
                            return;
                        }
                    }

                    if h_event.wait_for_event(1_000_000).is_err() {
                        eprintln!("[AudioForwarder] event wait failed");
                        break;
                    }
                }

                let _ = audio_client.stop_stream();
                eprintln!("[AudioForwarder] Capture loop restarting...");
                thread::sleep(Duration::from_millis(1000));
            }
        });
    }
}

#[cfg(not(windows))]
mod capture {
    use super::Args;
    use tokio::sync::mpsc;

    pub fn spawn_capture(_config: Args, _tx: mpsc::Sender<Vec<u8>>) {
        eprintln!("[AudioForwarder] Loopback capture is only implemented on Windows. Using synthetic tone.");
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let codec = Codec::parse(&args.codec);

    let (ws, _) = connect_async(&args.endpoint).await?;
    let (mut writer, mut reader) = ws.split();
    let current_source = Arc::new(AtomicU8::new(args.source));
    let source_for_reader = Arc::clone(&current_source);

    tokio::spawn(async move {
        while let Some(msg) = reader.next().await {
            if let Ok(Message::Text(text)) = msg {
                if let Ok(control) = serde_json::from_str::<VoiceControlEnvelope>(&text) {
                    if control.msg_type == "VOICE_CONTEXT" {
                        if let Some(data) = control.data {
                            if let Some(source) = data.source {
                                source_for_reader.store(source, Ordering::Relaxed);
                                println!("voice source -> {}", source);
                                continue;
                            }
                        }
                    }
                }
                println!("relay: {text}");
            }
        }
    });

    let mut seq: u32 = 0;
    let mut phase = 0.0_f32;

    println!("connected: {}", args.endpoint);
    println!(
        "source={} codec={} channels={} sample_rate={} frame_ms={} process_id={:?}",
        args.source,
        args.codec,
        args.channels,
        args.sample_rate,
        args.frame_ms,
        args.process_id
    );

    let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(128);
    capture::spawn_capture(args.clone(), audio_tx);

    loop {
        let payload = match codec {
            Codec::Pcm16Le => {
                match audio_rx.recv().await {
                    Some(chunk) => chunk,
                    None => generate_pcm_sine(args.channels, args.sample_rate, args.frame_ms, &mut phase),
                }
            }
            Codec::Opus => {
                // Opus encoder is still optional; keep transport path alive.
                vec![0_u8; 32]
            }
        };

        let packet = build_packet(
            current_source.load(Ordering::Relaxed),
            codec,
            args.channels,
            args.sample_rate,
            seq,
            &payload,
        );

        writer.send(Message::Binary(packet)).await?;
        seq = seq.wrapping_add(1);
    }
}
