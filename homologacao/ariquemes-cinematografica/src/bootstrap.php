<?php
declare(strict_types=1);
// Bloqueio de ambiente: este bootstrap jamais escolhe banco de produção.
if(getenv('ADS_LAB_ONLY')!=='1')throw new RuntimeException('Local lab not enabled');
$host=strtolower(explode(':',$_SERVER['HTTP_HOST']??'localhost')[0]);
if(!in_array($host,['localhost','127.0.0.1'],true))throw new RuntimeException('Local host required');
$root=dirname(__DIR__);$data=$root.'/data';
if(!is_file($data.'/prelaunch-test.sqlite')||!is_file($data.'/lab.key'))throw new RuntimeException('Initialize local lab first');
if(!is_dir($data.'/sessions'))mkdir($data.'/sessions',0700,true);
ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');
session_save_path($data.'/sessions');session_name('ads_lab_session');
session_set_cookie_params(['httponly'=>true,'samesite'=>'Strict','path'=>'/','secure'=>!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off']);
session_cache_limiter(''); // A API define explicitamente Cache-Control: no-store.
session_start();
$_SESSION['csrf']??=bin2hex(random_bytes(32));
$db=new PDO('sqlite:'.$data.'/prelaunch-test.sqlite');$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$db->exec('PRAGMA busy_timeout=3000');$db->exec('PRAGMA foreign_keys=ON');
$clientHash=hash_hmac('sha256',$_SERVER['REMOTE_ADDR']??'local',file_get_contents($data.'/lab.key'));
