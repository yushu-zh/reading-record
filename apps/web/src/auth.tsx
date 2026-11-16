import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from './api';
import { Feedback } from './forms';
import { Icon } from './visual';

export function SignIn({ signedIn }: { signedIn:()=>void }) {
  const [registering,setRegistering] = useState(false);
  const [nickname,setNickname] = useState('');
  const [password,setPassword] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  function switchMode() {
    setRegistering(value=>!value);
    setPassword(''); setError('');
  }
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(registering ? '/auth/register' : '/auth/login','POST',{nickname,password});
      setPassword(''); signedIn();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <main className="auth-view"><div className="auth-card panel">
    <div className="brand-icon"><Icon name="book" size={34}/></div>
    <h1>阅读打卡</h1>
    <form className="form" onSubmit={submit}>
      <label>昵称<input required value={nickname} maxLength={48} autoComplete="username" autoCapitalize="none"
        onChange={event=>setNickname(event.target.value)}/></label>
      <PasswordField label="密码" value={password} change={setPassword}
        autocomplete={registering ? 'new-password' : 'current-password'}/>
      <Feedback message={error}/>
      <button className="primary" disabled={busy}>{busy ? '正在提交…' : registering ? '注册' : '登录'}</button>
    </form>
    <div className="auth-links">
      <button className="text-button" onClick={switchMode} disabled={busy}>{registering ? '返回登录' : '注册账号'}</button>
    </div>
  </div></main>;
}

export function PasswordField({label,value,change,autocomplete}: {
  label:string; value:string; change:(value:string)=>void;
  autocomplete:'new-password'|'current-password';
}) {
  const [visible,setVisible] = useState(false);
  useEffect(()=>{if (!value) setVisible(false);},[value]);
  return <div className="password-field">
    <label>{label}<input required type={visible && value ? 'text' : 'password'} autoComplete={autocomplete}
      autoCapitalize="none" spellCheck={false} value={value}
      onChange={event=>change(event.target.value)}/></label>
    {value && <button type="button" className="icon-button password-visibility"
      aria-label={visible ? '隐藏'+label : '显示'+label} onClick={()=>setVisible(shown=>!shown)}>
      <Icon name={visible ? 'eye-off' : 'eye'} size={20}/>
    </button>}
  </div>;
}
