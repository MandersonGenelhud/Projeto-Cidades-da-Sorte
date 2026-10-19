<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'||getenv('ADS_LAB_ONLY')!=='1'){fwrite(STDERR,"Somente inicialização local explícita.\n");exit(1);}
$data=__DIR__.'/data';if(!is_dir($data))mkdir($data,0700,true);
if(is_file($data.'/prelaunch-test.sqlite')){echo "Banco de homologação já existe; nada foi apagado.\n";exit;}
$db=new PDO('sqlite:'.$data.'/prelaunch-test.sqlite');$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$db->exec(file_get_contents(__DIR__.'/tests/schema.sql'));
if(!is_file($data.'/lab.key'))file_put_contents($data.'/lab.key',bin2hex(random_bytes(32)),LOCK_EX);
chmod($data.'/lab.key',0600);echo "Banco LOCAL de homologação inicializado.\n";
