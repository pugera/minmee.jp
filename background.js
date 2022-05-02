var main = function () {
  var scene = new THREE.Scene();

  var width  = 420;
  var height = screen.height;
  var fov    = 60;
  var aspect = width / height;
  var near   = 1;
  var far    = 1000;
  var camera = new THREE.PerspectiveCamera( fov, aspect, near, far );

  camera.position.set( 0, 0, height/160 );
  camera.rotation.set( 0.2,0,0,);

  var renderer = new THREE.WebGLRenderer();
  renderer.setSize( width, height );
  document.getElementById("backscript").appendChild(renderer.domElement);

  var directionalLight = new THREE.DirectionalLight( 0xffffff );
  directionalLight.position.set( -9, 0.4, 10 );
  scene.add( directionalLight );

  var material = new THREE.MeshPhongMaterial( { color:0xffffff} );

  var geometry = new THREE.Geometry();

  geometry.vertices.push(new THREE.Vector3(0, 0, 1));
  geometry.vertices.push(new THREE.Vector3(1, 0, 0));
  geometry.vertices.push(new THREE.Vector3(0, -1, 0));
  geometry.vertices.push(new THREE.Vector3(-1, 0, 0));
  geometry.vertices.push(new THREE.Vector3(0, 1, 0));
  geometry.vertices.push(new THREE.Vector3(0, 0, -1));

  geometry.faces.push(new THREE.Face3( 0, 2, 1));
  geometry.faces.push(new THREE.Face3( 0, 3, 2));
  geometry.faces.push(new THREE.Face3( 0, 4, 3));
  geometry.faces.push(new THREE.Face3( 0, 1, 4));
  geometry.faces.push(new THREE.Face3( 5, 1, 2));
  geometry.faces.push(new THREE.Face3( 5, 2, 3));
  geometry.faces.push(new THREE.Face3( 5, 3, 4));
  geometry.faces.push(new THREE.Face3( 5, 4, 1));

  geometry.computeFaceNormals();

  //ワイヤーフレームのメッシュ作成
  var wire = new THREE.MeshBasicMaterial({color: 0xffffff, wireframe: true});
  var wireMesh = new THREE.Mesh(geometry, wire);
  scene.add(wireMesh);

  var wireMesh2 = new THREE.Mesh(geometry, wire);
  scene.add(wireMesh2);

  ( function renderLoop () {
    requestAnimationFrame( renderLoop );

    camera.rotation.set( -window.pageYOffset*0.0005 ,0,0,);

    wireMesh.rotation.y+=0.01;
    wireMesh.rotation.x=window.pageYOffset*0.005;

    wireMesh.position.y=2;

    wireMesh2.rotation.y+=0.01;
    wireMesh2.rotation.x=window.pageYOffset*0.005;

    wireMesh2.position.y=0;

    renderer.render( scene, camera );
  } )();
};

window.addEventListener( 'DOMContentLoaded', main, false );
