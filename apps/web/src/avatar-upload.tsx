import { useState, type FormEvent } from 'react';
import { api, errorText, RequestError } from './api';
import { Feedback } from './forms';

async function avatarJpeg(file:File) {
  const image = await createImageBitmap(file).catch(()=>{
    throw new RequestError('无法读取这张图片，请选择 JPG、PNG 或 WebP 图片。',422,'invalid_image');
  });
  try {
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=256;
    const context=canvas.getContext('2d');
    if (!context) throw new Error('Image canvas unavailable');
    context.fillStyle='#fff';
    context.fillRect(0,0,256,256);
    const square=Math.min(image.width,image.height);
    context.drawImage(image,(image.width-square)/2,(image.height-square)/2,square,square,0,0,256,256);
    const jpeg=canvas.toDataURL('image/jpeg',0.86);
    const prefix='data:image/jpeg;base64,';
    if (!jpeg.startsWith(prefix)) throw new Error('JPEG export failed');
    return jpeg.slice(prefix.length).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  } finally { image.close(); }
}

export function AvatarUpload({done}: {done:(version:string)=>Promise<void>}) {
  const [file,setFile]=useState<File|null>(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);setError('');
    try {
      const jpeg=await avatarJpeg(file);
      const result=await api<{avatarVersion:string}>('/me/avatar','PUT',{jpeg});
      await done(result.avatarVersion);
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <form className="form" onSubmit={submit}>
    <label>选择图片<input className="avatar-file" type="file" accept="image/*" required disabled={busy}
      onChange={event=>{setFile(event.target.files?.[0] ?? null);setError('');}}/></label>
    <Feedback message={error}/>
    <button className="primary" disabled={!file || busy}>{busy ? '正在上传…' : '保存头像'}</button>
  </form>;
}
