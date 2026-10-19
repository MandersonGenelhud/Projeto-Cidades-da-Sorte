<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('X-Robots-Tag: noindex, nofollow');
try{
 require __DIR__.'/../src/bootstrap.php';
 require __DIR__.'/../src/Prelaunch.php';
 $method=$_SERVER['REQUEST_METHOD']??'GET';
 if($method==='GET'){$result=['status'=>200,'body'=>['csrf'=>$_SESSION['csrf'],'mode'=>'local-test']];}
 elseif($method==='POST'){
  $contentType=strtolower(explode(';',$_SERVER['CONTENT_TYPE']??'')[0]);
  if($contentType!=='application/json')$result=['status'=>415,'body'=>['message'=>'Formato de teste inválido.']];
  else{
   $raw=file_get_contents('php://input',false,null,0,8193);
   if(strlen($raw)>8192)$result=['status'=>413,'body'=>['message'=>'Dados de teste excedem o limite.']];
   else{
    $input=json_decode($raw,true);
    if(!is_array($input)||array_is_list($input))$result=['status'=>400,'body'=>['message'=>'Requisição de teste inválida.']];
    else $result=registerPrelaunch($db,$input,(string)$_SESSION['csrf'],(string)($_SERVER['HTTP_X_CSRF_TOKEN']??''),$clientHash,time());
   }
  }
 }else{$result=['status'=>405,'body'=>['message'=>'Método não permitido.']];header('Allow: GET, POST');}
}catch(Throwable $error){$result=['status'=>503,'body'=>['message'=>'Homologação local indisponível. Confira a inicialização do ambiente de teste.']];}
http_response_code($result['status']);echo json_encode($result['body'],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
