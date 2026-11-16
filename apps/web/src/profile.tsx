import { useState, type FormEvent } from 'react';
import { api, errorText } from './api';
import { PasswordField } from './auth';
import { Feedback } from './forms';
import { Icon } from './visual';

export function ProfileView({nickname,back,updated}: {
  nickname:string; back:()=>void; updated:(nickname:string)=>Promise<void>;
}) {
  const [name,setName]=useState(nickname), [current,setCurrent]=useState(''), [next,setNext]=useState('');
  const [nameError,setNameError]=useState(''), [passwordError,setPasswordError]=useState('');
  const [nameSaved,setNameSaved]=useState(false), [passwordSaved,setPasswordSaved]=useState(false);
  const [busy,setBusy]=useState<'nickname'|'password'|null>(null);
  async function saveName(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy('nickname');setNameError('');setNameSaved(false);
    try {
      const result=await api<{nickname:string}>('/me/nickname','PATCH',{nickname:name});
      setName(result.nickname);
      await updated(result.nickname);
      setNameSaved(true);
    } catch (failure) { setNameError(errorText(failure)); }
    finally { setBusy(null); }
  }
  async function savePassword(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy('password');setPasswordError('');setPasswordSaved(false);
    try {
      await api('/me/password','PATCH',{currentPassword:current,newPassword:next});
      setCurrent('');setNext('');setPasswordSaved(true);
    } catch (failure) { setPasswordError(errorText(failure)); }
    finally { setBusy(null); }
  }
  return <main className="page-view profile-view">
    <header className="page-heading profile-heading">
      <button className="icon-button accent" aria-label="返回我的" onClick={back}><Icon name="left" size={20}/></button>
      <h1>个人资料</h1>
    </header>
    <form className="panel form profile-form" onSubmit={saveName}>
      <label>昵称<input required maxLength={48} value={name} autoComplete="username" autoCapitalize="none"
        onChange={event=>{setName(event.target.value);setNameSaved(false);}}/></label>
      <Feedback message={nameError}/>
      {nameSaved && <p className="hint" role="status">昵称已更新。</p>}
      <button className="primary" disabled={Boolean(busy) || name===nickname}>保存昵称</button>
    </form>
    <form className="panel form profile-form" onSubmit={savePassword}>
      <h2>修改密码</h2>
      <PasswordField label="当前密码" value={current} change={setCurrent} autocomplete="current-password"/>
      <PasswordField label="新密码" value={next} change={setNext} autocomplete="new-password"/>
      <Feedback message={passwordError}/>
      {passwordSaved && <p className="hint" role="status">密码已更新。</p>}
      <button className="primary" disabled={Boolean(busy)}>保存密码</button>
    </form>
  </main>;
}
