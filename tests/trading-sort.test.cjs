const {test}=require('node:test');
const assert=require('node:assert/strict');

test('Trading Hall sorts actual numeric prices instead of formatted text',async()=>{
  const {sortTradingRows}=await import('../src/renderer/trading-sort.mjs');
  const rows=[{price:'1,200 TK'},{price:'20 TK'},{price:'9 TK'}];
  assert.deepEqual(sortTradingRows(rows,{key:'price',dir:'asc'}).map(r=>r.price),['9 TK','20 TK','1,200 TK']);
  assert.deepEqual(sortTradingRows(rows,{key:'price',dir:'desc'}).map(r=>r.price),['1,200 TK','20 TK','9 TK']);
  assert.equal(rows[0].price,'1,200 TK');
});

test('Trading Hall rating order and missing columns remain explicit',async()=>{
  const {sortTradingRows,hasTradingSortData}=await import('../src/renderer/trading-sort.mjs');
  const rows=[{grade:'S+',salary:30,base:null},{grade:'D-',salary:5,base:null},{grade:'A',salary:null,base:null}];
  assert.deepEqual(sortTradingRows(rows,{key:'grade'}).map(x=>x.grade),['D-','A','S+']);
  assert.deepEqual(sortTradingRows(rows,{key:'salary',dir:'desc'}).map(x=>x.grade),['S+','D-','A']);
  assert.equal(hasTradingSortData(rows,'base'),false);
  assert.equal(hasTradingSortData(rows,'salary'),true);
});

test('B- through A+ excludes the same S and D- listings even after salary sorting',async()=>{
  const {filterTradingRows,sortTradingRows}=await import('../src/renderer/trading-sort.mjs');
  const rows=[
    {name:'Outlier S',grade:'S',salary:20,price:30,currency:'APK'},
    {name:'Outlier D',grade:'D-',salary:21,price:31,currency:'APK'},
    {name:'In range B',grade:'B-',salary:'1,200 TK',price:40,currency:'APK'},
    {name:'In range A',grade:'A+',salary:350,price:50,currency:'APK'},
    {name:'Unknown',grade:null,salary:10,price:5,currency:'APK'}
  ];
  const filters={gradeMin:'B-',gradeMax:'A+'};
  assert.deepEqual(sortTradingRows(filterTradingRows(rows,filters),{key:'salary',dir:'asc'})
    .map(r=>r.name),['In range A','In range B']);
  assert.deepEqual(sortTradingRows(filterTradingRows(rows,filters),{key:'salary',dir:'desc'})
    .map(r=>r.name),['In range B','In range A']);
  assert.deepEqual(rows.map(r=>r.grade),['S','D-','B-','A+',null]);
});

test('Trading Hall numeric bounds exclude missing values and read formatted salaries',async()=>{
  const {filterTradingRows}=await import('../src/renderer/trading-sort.mjs');
  const rows=[
    {grade:'B-',name:'Fit',seller:'First',position:'SG/SF',currency:'APK',salary:'1,200 TK',price:'2,500 APK'},
    {grade:'B-',name:'Too cheap',seller:'First',position:'SG/SF',currency:'APK',salary:300,price:120},
    {grade:'A',name:'Missing salary',seller:'First',position:'SG/SF',currency:'APK',salary:null,price:2500},
    {grade:'S',name:'Wrong grade',seller:'First',position:'SG/SF',currency:'APK',salary:1200,price:2500}
  ];
  assert.deepEqual(filterTradingRows(rows,{name:'Fit,Missing',position:'SF',gradeMin:'B-',gradeMax:'A+',
    salaryMin:'1000',salaryMax:'1300',priceMin:'2000',priceMax:'3000'})
    .map(r=>r.name),['Fit']);
  assert.deepEqual(filterTradingRows(rows,{gradeMin:'B-',gradeMax:'A+',salaryMax:'1200',salaryMaxExclusive:true})
    .map(r=>r.name),['Too cheap']);
});
