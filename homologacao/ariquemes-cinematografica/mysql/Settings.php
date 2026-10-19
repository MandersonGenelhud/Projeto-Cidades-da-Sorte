<?php
declare(strict_types=1);
/** Somente CLI/CI em loopback. Nunca aceita DSN arbitrário ou credenciais de produção. */
function mysqlHomologationSettings(array $env):array {
    if(($env['ADS_MYSQL_HOMOLOGATION']??'')!=='1')throw new RuntimeException('Modo de homologação MySQL não autorizado.');
    $host=$env['ADS_MYSQL_HOST']??'';$port=(string)($env['ADS_MYSQL_PORT']??'3306');
    $database=$env['ADS_MYSQL_DATABASE']??'';$user=$env['ADS_MYSQL_USER']??'';$password=$env['ADS_MYSQL_PASSWORD']??'';
    if(!in_array($host,['127.0.0.1','localhost'],true))throw new RuntimeException('Somente servidor MySQL local de teste.');
    if(!preg_match('/^[0-9]{1,5}$/',$port)||(int)$port<1||(int)$port>65535)throw new RuntimeException('Porta MySQL inválida.');
    if(!preg_match('/^ads_hml_[a-z0-9_]{1,48}$/D',$database))throw new RuntimeException('Banco exclusivo de homologação obrigatório.');
    if(!is_string($user)||$user===''||!is_string($password)||$password==='')throw new RuntimeException('Credenciais de teste obrigatórias.');
    return ['dsn'=>"mysql:host=$host;port=$port;dbname=$database;charset=utf8mb4",'user'=>$user,'password'=>$password,'host'=>$host];
}
function connectMysqlHomologation():PDO {
    if(PHP_SAPI!=='cli')throw new RuntimeException('Somente execução CLI de teste.');
    $config=mysqlHomologationSettings(getenv());
    return new PDO($config['dsn'],$config['user'],$config['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
}
